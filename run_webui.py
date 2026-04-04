import subprocess
import os
import sys
import time
import webbrowser
import signal

def run_webui():
    # 1. 获取基础路径
    root_dir = os.path.dirname(os.path.abspath(__file__))
    frontend_dir = os.path.join(root_dir, "webui", "frontend")
    
    # 2. 准备后端命令
    venv_python = os.path.join(root_dir, ".venv", "Scripts", "python.exe")
    if not os.path.exists(venv_python):
        venv_python = sys.executable # fallback
        
    backend_cmd = [
        venv_python, "-m", "uvicorn", 
        "webui.backend.main:app", 
        "--host", "127.0.0.1", 
        "--port", "8000"
    ]

    # 3. 准备前端命令 (Windows 下必须用 shell=True 才能找到 pnpm)
    frontend_cmd = "pnpm dev --port 5173"

    print("--- 正在启动 ImageDedup Web UI ---")
    
    # 启动后端
    print(f"正在启动后端服务 (端口 8000)...")
    backend_proc = subprocess.Popen(
        backend_cmd, 
        cwd=root_dir,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == 'nt' else 0
    )

    # 启动前端
    print(f"正在启动前端界面 (端口 5173)...")
    frontend_proc = subprocess.Popen(
        frontend_cmd,
        cwd=frontend_dir,
        shell=True,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == 'nt' else 0
    )

    # 稍微等一下服务启动
    time.sleep(3)
    
    print("\n服务已启动！")
    print("后端 API: http://127.0.0.1:8000")
    print("前端界面: http://localhost:5173")
    print("\n正在为您打开浏览器...")
    webbrowser.open("http://localhost:5173")
    print("\n提示: 按 Ctrl+C 可以同时停止前后端服务。")

    try:
        # 持续运行并监控进程
        while True:
            if backend_proc.poll() is not None:
                print("后端服务异常退出。")
                break
            if frontend_proc.poll() is not None:
                print("前端界面异常退出。")
                break
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n正在关闭所有服务...")
    finally:
        # 清理进程
        if os.name == 'nt':
            subprocess.run(['taskkill', '/F', '/T', '/PID', str(backend_proc.pid)], capture_output=True)
            subprocess.run(['taskkill', '/F', '/T', '/PID', str(frontend_proc.pid)], capture_output=True)
        else:
            os.killpg(os.getpgid(backend_proc.pid), signal.SIGTERM)
            os.killpg(os.getpgid(frontend_proc.pid), signal.SIGTERM)
        print("服务已停止。")

if __name__ == "__main__":
    run_webui()
