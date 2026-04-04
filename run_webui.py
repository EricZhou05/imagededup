import subprocess
import os
import sys
import time
import webbrowser
import threading

def run_backend():
    print("正在启动后端服务...")
    # 使用虚拟环境的 python 运行
    venv_python = os.path.join(".venv", "Scripts", "python.exe")
    if not os.path.exists(venv_python):
        venv_python = sys.executable # fallback
        
    subprocess.run([venv_python, "-m", "uvicorn", "webui.backend.main:app", "--host", "127.0.0.1", "--port", "8000"])

def run_frontend():
    print("正在启动前端界面...")
    # 在 webui/frontend 目录下运行 pnpm dev
    os.chdir(os.path.join("webui", "frontend"))
    subprocess.run(["pnpm", "dev", "--port", "5173"])

if __name__ == "__main__":
    # 启动后端
    backend_thread = threading.Thread(target=run_backend, daemon=True)
    backend_thread.start()
    
    # 稍微等一下后端启动
    time.sleep(2)
    
    # 启动前端并打开浏览器
    print("Web UI 正在准备中，请稍候...")
    webbrowser.open("http://localhost:5173")
    
    try:
        run_frontend()
    except KeyboardInterrupt:
        print("\n正在关闭服务...")
        sys.exit(0)
