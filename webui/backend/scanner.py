import os
import torch
import numpy as np
from pathlib import Path
from typing import List, Dict, Any, Callable, Optional
from imagededup.methods import CNN, PHash, DHash, AHash, WHash
from imagededup.utils.general_utils import get_files_to_remove
from .utils import get_image_metadata

class ScannerState:
    def __init__(self):
        self.progress = 0
        self.total = 0
        self.current_file = ""
        self.status = "idle"  # idle, scanning, clustering, finished, error
        self.error = ""
        self.results = []

class WebUIScanner:
    def __init__(self):
        self.state = ScannerState()
        self.methods = {
            "cnn": CNN,
            "phash": PHash,
            "dhash": DHash,
            "ahash": AHash,
            "whash": WHash
        }

    def scan(self, 
             directories: List[str], 
             method_name: str = "cnn", 
             threshold: float = 0.95, 
             recursive: bool = True,
             progress_callback: Optional[Callable[[int, int, str], None]] = None):
        
        self.state.status = "scanning"
        self.state.progress = 0
        self.state.results = []
        
        try:
            # 1. 收集所有文件
            all_files = []
            for d in directories:
                path = Path(d)
                if not path.is_dir():
                    continue
                pattern = "**/*" if recursive else "*"
                # 只获取图片文件 (这里简单通过后缀判断，imagededup 内部会有更细的判断)
                extensions = {'.jpg', '.jpeg', '.png', '.bmp', '.webp'}
                for p in path.glob(pattern):
                    if p.suffix.lower() in extensions:
                        all_files.append(str(p.absolute()))
            
            all_files = sorted(list(set(all_files))) # 去重并排序
            self.state.total = len(all_files)
            if self.state.total == 0:
                self.state.status = "finished"
                return []

            # 2. 初始化模型
            method_cls = self.methods.get(method_name.lower(), CNN)
            model = method_cls()
            
            # 3. 提取特征
            encoding_map = {}
            for i, f in enumerate(all_files):
                self.state.progress = i + 1
                self.state.current_file = f
                if progress_callback:
                    progress_callback(i + 1, self.state.total, f)
                
                try:
                    encoding = model.encode_image(image_file=f)
                    if encoding is not None:
                        encoding_map[f] = encoding
                except Exception as e:
                    print(f"Error encoding {f}: {e}")

            # 4. 寻找重复项
            self.state.status = "clustering"
            if method_name.lower() == "cnn":
                duplicates = model.find_duplicates(encoding_map=encoding_map, min_similarity_threshold=threshold)
            else:
                # Hashing 方法使用的是 max_distance_threshold
                # 假设用户传入的是 0~1 的相似度，我们需要转换
                # threshold 0.95 -> max_distance 64 * (1-0.95) = 3
                max_dist = int(64 * (1 - threshold))
                duplicates = model.find_duplicates(encoding_map=encoding_map, max_distance_threshold=max_dist)

            # 5. 聚类结果展示
            # duplicates 是 {file1: [file2, file3], file2: [file1, file3], ...}
            # 我们需要将其转换为 UI 友好的 Cluster 列表
            processed = set()
            clusters = []
            
            for file, dups in duplicates.items():
                if file in processed:
                    continue
                
                if dups:
                    # 将自己和所有重复项放入一个组
                    group = [file] + dups
                    # 元数据提取
                    group_data = []
                    for f in group:
                        meta = get_image_metadata(f)
                        group_data.append(meta)
                        processed.add(f)
                    
                    clusters.append({
                        "id": len(clusters),
                        "items": group_data
                    })
            
            self.state.results = clusters
            self.state.status = "finished"
            return clusters

        except Exception as e:
            self.state.status = "error"
            self.state.error = str(e)
            raise e
