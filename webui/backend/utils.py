import os
from pathlib import Path
from PIL import Image
from typing import Dict, Any

def get_image_metadata(file_path: str) -> Dict[str, Any]:
    """获取图片的元数据：分辨率、文件大小、原始路径。"""
    try:
        path = Path(file_path)
        stats = path.stat()
        with Image.open(file_path) as img:
            width, height = img.size
            
        return {
            "path": str(path.absolute()),
            "filename": path.name,
            "directory": str(path.parent.absolute()),
            "size_bytes": stats.st_size,
            "size_human": f"{stats.st_size / 1024 / 1024:.2f} MB",
            "resolution": f"{width}x{height}",
            "width": width,
            "height": height
        }
    except Exception as e:
        return {
            "path": str(file_path),
            "error": str(e)
        }

def move_file(source: str, destination_dir: str):
    """移动文件到指定目录，保持一定的结构或防止命名冲突。"""
    src_path = Path(source)
    dest_dir = Path(destination_dir)
    dest_dir.mkdir(parents=True, exist_ok=True)
    
    dest_path = dest_dir / src_path.name
    
    # 防止同名冲突
    counter = 1
    while dest_path.exists():
        name = f"{src_path.stem}_{counter}{src_path.suffix}"
        dest_path = dest_dir / name
        counter += 1
        
    src_path.rename(dest_path)
    return str(dest_path)
