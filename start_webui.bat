@echo off
chcp 65001 >nul
title ImageDedup WebUI 一键启动

echo ==============================================
echo 正在启动 ImageDedup WebUI...
echo 请保持此窗口打开以维持服务运行。
echo 遇到问题请按 Ctrl+C 终止并关闭所有服务。
echo ==============================================

:: 检查虚拟环境是否存在
if not exist ".venv\Scripts\python.exe" (
    echo [错误] 未找到虚拟环境 ".venv\Scripts\python.exe"
    echo 请确认是否已正确创建虚拟环境并安装依赖。
    pause
    exit /b 1
)

:: 使用虚拟环境的 Python 运行 WebUI 启动脚本
".venv\Scripts\python.exe" run_webui.py

echo.
echo 服务已退出。
pause
