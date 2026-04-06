import os
import torch
import numpy as np
import warnings
from pathlib import Path
from typing import List, Dict, Any, Callable, Optional
from imagededup.methods import CNN, PHash, DHash, AHash, WHash

# 隐藏 imagededup 内部关于 num_enc_workers 的冗余警告
warnings.filterwarnings('ignore', message='Parameter num_enc_workers has no effect')

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
             hash_size: int = 8,
             recursive: bool = True,
             progress_callback: Optional[Callable[[int, int, str], None]] = None,
             ignore_same_dir: bool = False):
        
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

            # 手动设置 hash_size 相关的内部属性 (imagededup 原生类不支持在 __init__ 中设置)
            if method_name.lower() != "cnn":
                if method_name.lower() == "phash":
                    model.target_size = (hash_size * 4, hash_size * 4)
                    # 关键：手动设置私有属性名
                    model._PHash__coefficient_extract = (hash_size, hash_size)
                    print(f"DEBUG: PHash injected - target_size: {model.target_size}, coeff: {model._PHash__coefficient_extract}")
                elif method_name.lower() == "ahash":
                    model.target_size = (hash_size, hash_size)
                    print(f"DEBUG: AHash injected - target_size: {model.target_size}")
                elif method_name.lower() == "dhash":
                    model.target_size = (hash_size + 1, hash_size)
                    print(f"DEBUG: DHash injected - target_size: {model.target_size}")
                elif method_name.lower() == "whash":
                    model.target_size = (hash_size, hash_size)
                    print(f"DEBUG: WHash injected - target_size: {model.target_size}")

            # 自行测试代码：验证哈希长度
            if method_name.lower() != "cnn" and all_files:
                test_f = all_files[0]
                test_enc = model.encode_image(image_file=test_f)
                print(f"DEBUG: Test file: {test_f}")
                print(f"DEBUG: Hash length: {len(test_enc) * 4} bits (hex length: {len(test_enc)})")
                print(f"DEBUG: Threshold used: {threshold}, Max Hamming Distance allowed: {int((hash_size ** 2) * (1 - threshold))}")

            # 3. 提取特征
            encoding_map = {}
            for i, f in enumerate(all_files):
                self.state.progress = i + 1
                self.state.current_file = f
                
                # 节流回调：每 10 个文件或最后一个文件时通知
                if progress_callback and (i % 10 == 0 or i == self.state.total - 1):
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
                # 已经手动提取了 encoding_map，此时 find_duplicates 不应传递编码相关的参数以避免警告
                duplicates = model.find_duplicates(encoding_map=encoding_map, min_similarity_threshold=threshold)
            else:
                # Hashing 方法使用的是 max_distance_threshold
                # 汉明距离的最大值为 hash_size * hash_size
                # 注意：imagededup 库内部要求该阈值在 0-64 之间
                max_dist = int((hash_size ** 2) * (1 - threshold))
                if max_dist > 64:
                    print(f"WARNING: Calculated max_dist {max_dist} exceeds the library limit (64). Clamping to 64.")
                    max_dist = 64
                elif max_dist < 0:
                    max_dist = 0
                
                print(f"DEBUG: Using max_distance_threshold: {max_dist}")
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
                    
                    # 过滤逻辑：如果不对比同目录文件
                    if ignore_same_dir:
                        # 获取所有文件的父目录
                        parent_dirs = {os.path.dirname(f) for f in group}
                        # 如果所有图片都在同一个目录下，则忽略该组
                        if len(parent_dirs) <= 1:
                            # 注意：即使忽略该组，也需要将这些文件标记为已处理，防止后续重复处理
                            for f in group:
                                processed.add(f)
                            continue

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
