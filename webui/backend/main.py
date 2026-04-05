import os
import asyncio
from typing import List, Optional
from fastapi import FastAPI, BackgroundTasks, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from .scanner import WebUIScanner
from .utils import move_file

app = FastAPI(title="imagededup Web UI API")

# 允许跨域
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

scanner = WebUIScanner()
main_loop = None

@app.on_event("startup")
async def startup_event():
    global main_loop
    main_loop = asyncio.get_event_loop()

class ScanRequest(BaseModel):
    directories: List[str]
    method: str = "cnn"
    threshold: float = 0.95
    recursive: bool = True
    ignore_same_dir: bool = False

class MoveRequest(BaseModel):
    files: List[str]
    destination: str

# 用于管理 WebSocket 连接
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                pass

manager = ConnectionManager()

def progress_callback(current, total, filename):
    if main_loop:
        asyncio.run_coroutine_threadsafe(
            manager.broadcast({
                "type": "progress",
                "progress": current,
                "total": total,
                "filename": filename,
                "status": "scanning"
            }),
            main_loop
        )

@app.websocket("/ws/status")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)

@app.post("/api/scan")
async def start_scan(request: ScanRequest, background_tasks: BackgroundTasks):
    if scanner.state.status == "scanning":
        return {"error": "Scan already in progress"}
    
    # 在后台执行扫描
    background_tasks.add_task(
        scanner.scan, 
        request.directories, 
        request.method, 
        request.threshold, 
        request.recursive,
        progress_callback,
        request.ignore_same_dir
    )
    
    return {"message": "Scan started"}

@app.get("/api/status")
async def get_status():
    return {
        "status": scanner.state.status,
        "progress": scanner.state.progress,
        "total": scanner.state.total,
        "current_file": scanner.state.current_file,
        "error": scanner.state.error
    }

@app.get("/api/results")
async def get_results():
    return scanner.state.results

@app.post("/api/move")
async def execute_move(request: MoveRequest):
    moved = []
    errors = []
    for f in request.files:
        try:
            new_path = move_file(f, request.destination)
            moved.append({"old": f, "new": new_path})
        except Exception as e:
            errors.append({"file": f, "error": str(e)})
    
    return {"moved": moved, "errors": errors}

@app.get("/api/image")
async def get_image(path: str):
    # 安全检查：由于是本地工具，这里简单判断文件是否存在
    # 在生产环境应该严格限制目录访问
    if os.path.exists(path) and os.path.isfile(path):
        return FileResponse(path)
    raise HTTPException(status_code=404, detail="Image not found")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
