import subprocess
import os
import sys
import time
import webbrowser
import signal

def kill_process_on_port(port):
    """强制关闭占用指定端口的进程 (Windows 平台)"""
    if os.name != 'nt':
        return
    try:
        # 查找监听指定端口的 PID
        # netstat -ano 输出格式通常为: TCP 0.0.0.0:8000 0.0.0.0:0 LISTENING 1234
        cmd = f'netstat -ano | findstr LISTENING | findstr :{port}'
        output = subprocess.check_output(cmd, shell=True).decode()
        
        pids = set()
        for line in output.strip().split('\n'):
            line = line.strip()
            if not line: continue
            parts = line.split()
            # 简单校验确保是目标端口
            if f":{port}" in parts[1]:
                pids.add(parts[-1])
        
        for pid in pids:
            if pid != '0':
                subprocess.run(['taskkill', '/F', '/T', '/PID', pid], capture_output=True)
                print(f"--- 端口 {port} 已清理 (PID: {pid}) ---")
    except Exception:
        # 没有找到占用进程或没有权限时跳过
        pass

def run_webui():
    # 1. 获取基础路径
    root_dir = os.path.dirname(os.path.abspath(__file__))
    frontend_dir = os.path.join(root_dir, "webui", "frontend")
    
    # 2. 准备后端命令
    venv_python = os.path.join(root_dir, ".venv", "Scripts", "python.exe")
    if not os.path.exists(venv_python):
        venv_python = sys.executable # fallback
        
    # 将列表转为字符串以便 shell=True 执行
    backend_cmd = f'"{venv_python}" -m uvicorn webui.backend.main:app --host 127.0.0.1 --port 8000'

    # 3. 准备前端命令
    frontend_cmd = "pnpm dev --port 5173"

    print("--- 正在启动 ImageDedup Web UI ---")
    
    # 0. 启动前强制清理端口
    print("正在检查并清理残留端口...")
    kill_process_on_port(8000) # 后端
    kill_process_on_port(5173) # 前端
    
    # 启动后端 (直接输出到主控制台，避免管道阻塞)
    print(f"正在启动后端服务 (端口 8000)...")
    backend_proc = subprocess.Popen(
        backend_cmd, 
        cwd=root_dir,
        shell=True,
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
                print(f"\n[错误] 后端服务已停止 (退出码: {backend_proc.returncode})")
                break
            if frontend_proc.poll() is not None:
                print(f"\n[错误] 前端界面已停止 (退出码: {frontend_proc.returncode})")
                break
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n正在关闭所有服务...")
    finally:
        # 清理进程
        if os.name == 'nt':
            # 使用 taskkill 确保清理整个进程树
            subprocess.run(['taskkill', '/F', '/T', '/PID', str(backend_proc.pid)], capture_output=True)
            subprocess.run(['taskkill', '/F', '/T', '/PID', str(frontend_proc.pid)], capture_output=True)
        else:
            try:
                os.killpg(os.getpgid(backend_proc.pid), signal.SIGTERM)
                os.killpg(os.getpgid(frontend_proc.pid), signal.SIGTERM)
            except:
                pass
        print("服务已停止。")

if __name__ == "__main__":
    run_webui()
