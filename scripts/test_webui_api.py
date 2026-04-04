import subprocess
import time
import requests
import os
import sys
import signal

def test_api():
    base_url = "http://127.0.0.1:8000"
    
    # 1. 启动后端服务
    print("正在启动后端服务进行测试...")
    venv_python = os.path.join(".venv", "Scripts", "python.exe")
    process = subprocess.Popen(
        [venv_python, "-m", "uvicorn", "webui.backend.main:app", "--host", "127.0.0.1", "--port", "8000"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True
    )
    
    time.sleep(5) # 增加等待时间
    
    # 检查进程是否还在运行
    if process.poll() is not None:
        print("后端服务进程意外终止。")
        stdout, stderr = process.communicate()
        print(f"STDOUT: {stdout}")
        print(f"STDERR: {stderr}")
        return
    
    try:
        # 2. 测试 /api/status
        print("测试 /api/status...")
        resp = requests.get(f"{base_url}/api/status")
        print(f"Status: {resp.status_code}, Body: {resp.json()}")
        
        # 3. 测试 /api/scan
        print("测试 /api/scan...")
        test_dir = os.path.abspath("tests/data/mixed_images")
        scan_payload = {
            "directories": [test_dir],
            "method": "cnn",
            "threshold": 0.9,
            "recursive": True
        }
        resp = requests.post(f"{base_url}/api/scan", json=scan_payload)
        print(f"Scan response: {resp.json()}")
        
        # 4. 轮询状态
        print("等待扫描完成...")
        for _ in range(30):
            time.sleep(2)
            resp = requests.get(f"{base_url}/api/status")
            status_data = resp.json()
            print(f"Current Status: {status_data.get('status')} - Progress: {status_data.get('progress')}/{status_data.get('total')}")
            if status_data.get("status") == "finished":
                break
        
        # 5. 获取结果
        print("获取结果...")
        resp = requests.get(f"{base_url}/api/results")
        results = resp.json()
        print(f"Found {len(results)} clusters.")
        for i, cluster in enumerate(results):
            print(f"Cluster {i}: {[item['filename'] for item in cluster['items']]}")
            
        if len(results) > 0:
            print("API 测试成功！")
        else:
            print("未发现重复项，请检查测试数据或阈值。")
            
    except Exception as e:
        print(f"测试过程中出错: {e}")
    finally:
        print("正在关闭后端服务...")
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()

if __name__ == "__main__":
    test_api()
