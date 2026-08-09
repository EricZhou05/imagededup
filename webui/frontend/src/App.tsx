import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { 
  Search, 
  FolderOpen, 
  Trash2, 
  CheckCircle2, 
  Maximize2, 
  Loader2,
  ArrowRightLeft,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  MousePointer2,
  Keyboard,
  HelpCircle
} from 'lucide-react';
import './App.css';

interface ImageMeta {
  path: string;
  filename: string;
  directory: string;
  size_human: string;
  resolution: string;
  size_bytes: number;
  width: number;
  height: number;
  modified_at: string;
  modified_timestamp: number;
}

interface Cluster {
  id: number;
  items: ImageMeta[];
}

interface ScanStatus {
  status: string;
  progress: number;
  total: number;
  current_file: string;
  error: string;
}

// ============ 配置持久化：刷新页面后保留用户填写的内容 ============
const CONFIG_KEY = 'imagededup_webui_config';

interface SavedConfig {
  directories: string;
  method: string;
  hashSize: number;
  threshold: number;
  recursive: boolean;
  ignoreSameDir: boolean;
  smartSelect: boolean;
  destination: string;
}

function loadSavedConfig(): Partial<SavedConfig> {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw ? JSON.parse(raw) as Partial<SavedConfig> : {};
  } catch {
    return {};
  }
}

// 图片缩放平移组件
const ImageCanvas = ({ src, scale, offset, onTransform }: any) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });

  // 修复滚轮冲突：手动绑定非 passive 事件
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheelRaw = (e: WheelEvent) => {
      e.preventDefault(); // 阻止网页滚动
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newScale = Math.min(Math.max(scale * delta, 0.5), 20); // 限制缩放范围
      onTransform(newScale, offset);
    };

    container.addEventListener('wheel', handleWheelRaw, { passive: false });
    return () => container.removeEventListener('wheel', handleWheelRaw);
  }, [scale, offset, onTransform]);

  const handleMouseDown = (e: React.MouseEvent) => {
    isDragging.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging.current) return;
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    onTransform(scale, { x: offset.x + dx, y: offset.y + dy });
    lastPos.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseUp = () => {
    isDragging.current = false;
  };

  return (
    <div 
      ref={containerRef}
      className="image-canvas-container"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div 
        className="image-canvas"
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          transition: isDragging.current ? 'none' : 'transform 0.1s ease-out'
        }}
      >
        <img src={src} alt="compare" draggable={false} />
      </div>
    </div>
  );
};

// 路径差异高亮逻辑
const HighlightPath = ({ path, allPaths }: { path: string, allPaths: string[] }) => {
  if (allPaths.length < 2) return <span>{path}</span>;
  
  const parts = path.split('\\');
  const others = allPaths.filter(p => p !== path).map(p => p.split('\\'));
  
  return (
    <span className="path-diff">
      {parts.map((part, i) => {
        const isDifferent = others.some(other => other[i] !== part);
        return (
          <span key={i}>
            {i > 0 && '\\'}
            {isDifferent ? <b>{part}</b> : part}
          </span>
        );
      })}
    </span>
  );
};

function App() {
  const [savedConfig] = useState(loadSavedConfig);
  const [directories, setDirectories] = useState<string>(savedConfig.directories ?? '');
  const [method, setMethod] = useState(savedConfig.method ?? 'dhash');
  const [hashSize, setHashSize] = useState(savedConfig.hashSize ?? 32);
  const [threshold, setThreshold] = useState(savedConfig.threshold ?? 1);
  const [recursive, setRecursive] = useState(savedConfig.recursive ?? true);
  const [ignoreSameDir, setIgnoreSameDir] = useState(savedConfig.ignoreSameDir ?? false);
  const [smartSelect, setSmartSelect] = useState(savedConfig.smartSelect ?? true);
  const [isConfigExpanded, setIsConfigExpanded] = useState(true);
  
  const [status, setStatus] = useState<ScanStatus>({
    status: 'idle', progress: 0, total: 0, current_file: '', error: ''
  });
  
  const [results, setResults] = useState<Cluster[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [innerIndex, setInnerIndex] = useState(0); // 组内当前图片索引
  const [deletes, setDeletes] = useState<Record<number, string[]>>({}); // clusterId -> deletePaths[]
  const [destination, setDestination] = useState(savedConfig.destination ?? '');

  // 当目录改变时，自动填充备份目录（仅在用户未手动填写时）
  useEffect(() => {
    const firstDir = directories.split('\n').filter(d => d.trim())[0];
    if (firstDir) {
      setDestination(prev => prev || firstDir.trim() + '_dedup');
    }
  }, [directories]);

  // 配置变更时持久化到 localStorage，刷新后不丢失
  useEffect(() => {
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify({
        directories, method, hashSize, threshold, recursive, ignoreSameDir, smartSelect, destination
      }));
    } catch { /* localStorage 不可用时静默失败 */ }
  }, [directories, method, hashSize, threshold, recursive, ignoreSameDir, smartSelect, destination]);
  
  // 缩放状态
  const [transform, setTransform] = useState({ scale: 1, offset: { x: 0, y: 0 } });
  
  const currentCluster = results[currentIndex];
  const ws = useRef<WebSocket | null>(null);

  // 快捷键处理
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!currentCluster) return;
      
      // 数字键 1, 2, 3... 选择 (针对当前显示的图片进行切换选中)
      if (e.key >= '1' && e.key <= '9') {
        const idx = parseInt(e.key) - 1;
        if (idx < currentCluster.items.length) {
          setInnerIndex(idx);
        }
      }

      // 左右方向键：切换组内图片 (闪烁对比)
      if (e.key === 'ArrowRight') {
        setInnerIndex(prev => (prev + 1) % currentCluster.items.length);
      }
      if (e.key === 'ArrowLeft') {
        setInnerIndex(prev => (prev - 1 + currentCluster.items.length) % currentCluster.items.length);
      }

      // 上下方向键：切换重复组
      if (e.key === 'ArrowDown') nextCluster();
      if (e.key === 'ArrowUp') prevCluster();

      // 回车或空格：切换当前图片的选中状态
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleToggleSelect(currentCluster.items[innerIndex].path);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentCluster, currentIndex, innerIndex, results, deletes]);

  const handleToggleSelect = (path: string) => {
    setDeletes(prev => {
      const currentDeletes = prev[currentCluster.id] || [];
      if (currentDeletes.includes(path)) {
        return { ...prev, [currentCluster.id]: currentDeletes.filter(p => p !== path) };
      } else {
        return { ...prev, [currentCluster.id]: [...currentDeletes, path] };
      }
    });
  };

  const nextCluster = () => {
    if (currentIndex < results.length - 1) {
      setCurrentIndex(prev => prev + 1);
      setInnerIndex(0);
      setTransform({ scale: 1, offset: { x: 0, y: 0 } });
    }
  };

  const prevCluster = () => {
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
      setInnerIndex(0);
      setTransform({ scale: 1, offset: { x: 0, y: 0 } });
    }
  };

  const connectWS = () => {
    if (ws.current && (ws.current.readyState === WebSocket.OPEN || ws.current.readyState === WebSocket.CONNECTING)) {
      return;
    }
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/status`;
    const socket = new WebSocket(wsUrl);
    ws.current = socket;
    socket.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type !== 'progress') return;
        setStatus(prev => ({
          ...prev,
          progress: typeof data.progress === 'number' ? data.progress : prev.progress,
          total: typeof data.total === 'number' ? data.total : prev.total,
          current_file: data.current_file ?? data.filename ?? prev.current_file,
          status: data.status ?? prev.status,
        }));
        if (data.status === 'finished') {
          fetchResults();
        }
      } catch { /* 忽略非法消息 */ }
    };
    socket.onerror = () => {};
    socket.onclose = () => { ws.current = null; };
  };

  useEffect(() => {
    connectWS();
    return () => { ws.current?.close(); ws.current = null; };
  }, []);

  const startScan = async () => {
    const dirs = directories.split('\n').filter(d => d.trim());
    if (dirs.length === 0) return alert('请输入至少一个目录');

    setResults([]);
    setDeletes({});
    setCurrentIndex(0);
    setInnerIndex(0);
    // 立即进入 scanning 状态以激活轮询，不依赖 WebSocket 首条推送
    setStatus({ status: 'scanning', progress: 0, total: 0, current_file: '', error: '' });

    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          directories: dirs, 
          method, 
          threshold, 
          hash_size: hashSize, 
          recursive, 
          ignore_same_dir: ignoreSameDir 
        })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      setStatus(prev => ({ ...prev, status: 'error', error: '启动扫描失败：无法连接后端服务' }));
      alert('启动扫描失败');
    }
  };

  const fetchResults = async () => {
    const res = await fetch('/api/results');
    const data = await res.json();
    setResults(data);
    if (data.length > 0) {
      setIsConfigExpanded(false);
    }
  };

  // 后台实时计算智能判定结果
  const smartDeletes = useMemo(() => {
    const newDeletes: Record<number, string[]> = {};
    results.forEach((c: Cluster) => { 
      const toDelete = c.items.reduce((prev, curr) => {
        const sizeDiff = Math.abs(prev.size_bytes - curr.size_bytes);
        const thresholdBytes = 0.01 * 1024 * 1024; // 0.01MB
        if (sizeDiff <= thresholdBytes) {
          return prev.modified_timestamp > curr.modified_timestamp ? prev : curr;
        }
        return prev.size_bytes < curr.size_bytes ? prev : curr;
      });
      newDeletes[c.id] = [toDelete.path]; 
    });
    return newDeletes;
  }, [results]);

  // 当结果集初次加载且开启了智能勾选时，自动应用
  useEffect(() => {
    if (results.length > 0 && smartSelect) {
      setDeletes(smartDeletes);
    }
  }, [results]);

  // 切换开关时实时更新勾选状态
  const handleSmartSelectToggle = (checked: boolean) => {
    setSmartSelect(checked);
    if (checked) {
      setDeletes(smartDeletes);
    } else {
      setDeletes({});
    }
  };

  // scanning/clustering 期间每秒轮询后端状态，保证进度实时跟进
  useEffect(() => {
    if (status.status !== 'scanning' && status.status !== 'clustering') return;
    const timer = window.setInterval(async () => {
      try {
        const res = await fetch('/api/status');
        if (!res.ok) return;
        const data = await res.json();
        setStatus(data);
        if (data.status === 'finished') {
          fetchResults();
        }
      } catch {
        // 网络异常时继续重试，轮询兜底
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [status.status]);

  // 页面加载时同步一次后端状态：刷新页面后立即恢复对进行中任务的监控
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/status');
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setStatus(data);
        if (data.status === 'finished') {
          fetchResults();
        }
      } catch { /* 后端未就绪时忽略 */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleMove = async () => {
    if (!destination) return alert('请输入目标备份目录');
    const toMove: string[] = [];
    results.forEach(cluster => {
      const deletePaths = deletes[cluster.id] || [];
      toMove.push(...deletePaths);
    });
    if (toMove.length === 0) return alert('没有需要移动的文件');
    if (!confirm(`确定移动 ${toMove.length} 个文件吗？`)) return;
    try {
      await fetch('/api/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: toMove, destination })
      });
      alert('移动成功');
      setResults([]);
      setIsConfigExpanded(true);
    } catch (e) { alert('移动失败'); }
  };

  // 查找最小属性
  const minStats = useMemo(() => {
    if (!currentCluster) return { size: 0, res: 0, hasDifferentModified: false };
    const timestamps = currentCluster.items.map(i => i.modified_timestamp);
    return {
      size: Math.min(...currentCluster.items.map(i => i.size_bytes)),
      res: Math.min(...currentCluster.items.map(i => i.width * i.height)),
      hasDifferentModified: new Set(timestamps).size > 1
    };
  }, [currentCluster]);

  const currentItem = currentCluster?.items[innerIndex];

  return (
    <div className="app-container">
      <aside className="sidebar">
        <div className="logo">
          <Search size={24} color="#3b82f6" />
          <span>图像去重 Web UI</span>
        </div>
        
        <div className="section">
          <h3 className="collapsible-header" onClick={() => setIsConfigExpanded(!isConfigExpanded)}>
            <div className="header-label">
              <FolderOpen size={16} /> 扫描配置
            </div>
            {isConfigExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </h3>
          {isConfigExpanded && (
            <div className="collapsible-content">
              <div className="field">
                <label>目标目录 (一行一个)</label>
                <textarea 
                  value={directories} 
                  onChange={e => setDirectories(e.target.value)} 
                  placeholder="D:\Photos&#10;E:\Backup" 
                  rows={4}
                />
              </div>
              <div className="field">
                <label className="label-with-help">
                  算法
                  <div className="tooltip-wrapper">
                    <HelpCircle size={14} className="help-icon" />
                    <div className="tooltip-content">
                      <div className="tooltip-title">💡 图像对比算法选择指南：</div>
                      <div className="tooltip-item"><strong>CNN (AI模型)：</strong>最智能。识别图像“语义”，适合寻找内容相同但风格迥异（如原图 vs 手绘、大幅裁剪）的图片。</div>
                      <div className="tooltip-item"><strong>PHash (感知)：</strong>最推荐。对亮度、色调及微小旋转不敏感，是识别相似图、日常查重的首选算法。</div>
                      <div className="tooltip-item"><strong>DHash (差异)：</strong>最平衡。速度极快，且在图片被拉伸或长宽比变化时表现最稳健，适合海量图集初筛。</div>
                      <div className="tooltip-item"><strong>WHash (小波)：</strong>更细腻。专为处理高压缩、多噪点的低画质图像优化，识别细节纹理更精准。</div>
                      <div className="tooltip-item"><strong>AHash (均值)：</strong>极简。仅适用于寻找几乎完全一致的缩略图，对环境干扰抵抗力较弱。</div>
                      <div className="tooltip-footer"><strong>应用建议：</strong>深度检索选 CNN，日常查重选 PHash，追求极致速度选 DHash。</div>
                    </div>
                  </div>
                </label>
                <select value={method} onChange={e => setMethod(e.target.value)}>
                  <option value="cnn">卷积神经网络 (CNN)</option>
                  <option value="phash">感知哈希 (PHash)</option>
                  <option value="dhash">差异哈希 (DHash)</option>
                  <option value="whash">小波哈希 (WHash)</option>
                  <option value="ahash">均值哈希 (AHash)</option>
                </select>
              </div>
              {method !== 'cnn' && (
                <div className="field">
                  <label className="label-with-help">
                    哈希大小 (Hash Size)
                    <div className="tooltip-wrapper">
                      <HelpCircle size={14} className="help-icon" />
                      <div className="tooltip-content">
                        <div className="tooltip-title">💡 如何选择哈希大小？</div>
                        <div className="tooltip-item"><strong>极速查重 (Size 8)：</strong>忽略细节，只看大轮廓。适合找原图或海量库初步过滤。</div>
                        <div className="tooltip-item"><strong>细节比对 (Size 16/32)：</strong>记录图像细节。Size 32 可分辨眨眼等微小差分。</div>
                        <div className="tooltip-item"><strong>显微镜级 (Size 64)：</strong>极度敏感。肉眼不可见的压缩噪点也会导致匹配失败。</div>
                        <div className="tooltip-footer"><strong>黄金平衡：</strong>DHash + Size 32 + 阈值 1 是二次元插画避免表情差分被误判的性能/精度最佳点。</div>
                      </div>
                    </div>
                  </label>
                  <select value={hashSize} onChange={e => setHashSize(parseInt(e.target.value))}>
                    <option value={8}>8</option>
                    <option value={16}>16</option>
                    <option value={32}>32 (默认)</option>
                    <option value={64}>64</option>
                  </select>
                </div>
              )}
              <div className="field">
                <label className="label-with-help">
                  相似度阈值 ({threshold})
                  <div className="tooltip-wrapper">
                    <HelpCircle size={14} className="help-icon" />
                    <div className="tooltip-content">
                      <div className="tooltip-title">💡 阈值与哈希大小组合策略：</div>
                      <div className="tooltip-item"><strong>极速模式 (Size 8)：</strong>建议 0.95-1.0。步长0.02，设 0.99 将会与 1.0 等效。</div>
                      <div className="tooltip-item"><strong>细节模式 (Size 16/32)：</strong>建议 0.90-0.98。调节细腻，0.01 的变动会有明显感知。</div>
                      <div className="tooltip-item"><strong>显微镜模式 (Size 64)：</strong>建议 0.80-0.95。设 1.0 极难匹配，除非文件二进制完全一致。</div>
                      <div className="tooltip-footer"><strong>建议：</strong>如果要区分极其相似的差分图，请提高 Size 并保持极高阈值。</div>
                    </div>
                  </div>
                </label>
                <input type="range" min="0" max="1.0" step="0.01" value={threshold} onChange={e => setThreshold(parseFloat(e.target.value))} />
              </div>
              <div className="field checkbox-field">
                <input 
                  type="checkbox" 
                  id="ignoreSameDir" 
                  checked={ignoreSameDir} 
                  onChange={e => setIgnoreSameDir(e.target.checked)} 
                />
                <label htmlFor="ignoreSameDir" className="label-with-help">
                  不对比同目录文件
                  <div className="tooltip-wrapper">
                    <HelpCircle size={14} className="help-icon" />
                    <div className="tooltip-content">
                      <div className="tooltip-title">💡 何时忽略同目录？</div>
                      <div className="tooltip-item"><strong>📂 跨目录查重：</strong>当你确信单文件夹内没有重复，只想清理跨硬盘或跨备份路径的冗余时开启。</div>
                      <div className="tooltip-item"><strong>📸 保留连拍：</strong>如果你在同一文件夹下存有大量极其相似的连拍图，开启此项可避免它们出现在结果中。</div>
                    </div>
                  </div>
                </label>
              </div>
              <div className="field checkbox-field">
                <input 
                  type="checkbox" 
                  id="smartSelect" 
                  checked={smartSelect} 
                  onChange={e => handleSmartSelectToggle(e.target.checked)} 
                />
                <label htmlFor="smartSelect" className="label-with-help">
                  智能勾选
                  <div className="tooltip-wrapper">
                    <HelpCircle size={14} className="help-icon" />
                    <div className="tooltip-content">
                      <div className="tooltip-title">💡 智能勾选逻辑说明：</div>
                      <div className="tooltip-item"><strong>📏 容量优先：</strong>若重复组内文件大小差异显著（&gt;0.01MB），系统将自动勾选体积较小的文件待删。</div>
                      <div className="tooltip-item"><strong>🕒 时间判定：</strong>若文件大小几乎一致（差异&le;0.01MB），系统将自动勾选修改时间较晚（更新）的文件待删。</div>
                      <div className="tooltip-item" style={{color: '#f87171', marginTop: '0.5rem', borderTop: '1px dashed #444', paddingTop: '0.5rem'}}>
                        <strong>⚠️ 注意：</strong>切换此开关将立即覆盖您在预览区进行的所有手动勾选数据！
                      </div>
                      <div className="tooltip-footer"><strong>建议：</strong>开启后可极大减少手动比对工作量。</div>
                    </div>
                  </div>
                </label>
              </div>
              <button className="btn-primary" onClick={startScan} disabled={status.status === 'scanning' || status.status === 'clustering'}>
                {status.status === 'scanning' ? <Loader2 className="spin" /> : <Search size={18} />} 开始扫描
              </button>
            </div>
          )}
        </div>

        {results.length > 0 && (
          <div className="section">
            <h3><Trash2 size={16} /> 处理操作</h3>
            <div className="field">
              <label>备份至</label>
              <input type="text" value={destination} onChange={e => setDestination(e.target.value)} placeholder="D:\Backup" />
            </div>
            <button className="btn-danger" onClick={handleMove} style={{ marginBottom: '1rem' }}>
              <ArrowRightLeft size={18} /> 执行移动
            </button>

            {currentCluster && (
              <div className="current-actions">
                <div className="action-divider" />
                <h3>当前组控制</h3>
                <div className="selection-stats">
                  待删除 {deletes[currentCluster.id]?.length || 0} / {currentCluster.items.length}
                </div>
                
                <button 
                  className={`btn-sidebar-action btn-delete-toggle ${deletes[currentCluster.id]?.includes(currentItem.path) ? 'active' : ''}`}
                  onClick={() => handleToggleSelect(currentItem.path)}
                >
                  <CheckCircle2 size={18} /> 
                  {deletes[currentCluster.id]?.includes(currentItem.path) ? '取消删除' : '勾选删除'}
                </button>

                <div className="nav-buttons">
                  <button className="btn-sidebar-nav" onClick={prevCluster} disabled={currentIndex === 0}>
                    <ChevronLeft size={18} /> 上一组
                  </button>
                  <button className="btn-sidebar-nav btn-next-sidebar" onClick={nextCluster}>
                    下一组 <ChevronRight size={18} />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </aside>

      <main className="main-content" style={{ padding: 0, display: 'flex', flexDirection: 'column' }}>
        {status.status === 'error' ? (
          <div className="progress-overlay">
            <div className="progress-card">
              <h2 style={{ color: '#f87171' }}>出错了</h2>
              <p style={{ color: '#e5e5e5', wordBreak: 'break-all', marginTop: '0.75rem' }}>{status.error || '未知错误'}</p>
              <button
                className="btn-primary"
                style={{ marginTop: '1.5rem' }}
                onClick={() => setStatus(prev => ({ ...prev, status: 'idle', error: '' }))}
              >
                返回
              </button>
            </div>
          </div>
        ) : status.status === 'scanning' || status.status === 'clustering' ? (
          <div className="progress-overlay">
            <div className="progress-card">
              <h2>{status.status === 'scanning' ? '分析中...' : '比对中...'}</h2>
              <div className="progress-bar-bg"><div className="progress-bar-fill" style={{ width: `${(status.progress / (status.total || 1)) * 100}%` }} /></div>
              <p>{status.progress} / {status.total}</p>
            </div>
          </div>
        ) : currentCluster ? (
          <div className="feed-view">
            <header className="feed-header">
              <div className="feed-progress">
                组 {currentIndex + 1} / {results.length} | 图片 {innerIndex + 1} / {currentCluster.items.length}
              </div>
              <div className="shortcut-hint">
                <span><span className="shortcut-key">←/→</span> 组内切换</span>
                <span><span className="shortcut-key">↑/↓</span> 上下组</span>
                <span><span className="shortcut-key">Space/Enter</span> 勾选删除</span>
              </div>
            </header>

            <div className="compare-viewport single-mode">
              <div className={`compare-item-v2 ${deletes[currentCluster.id]?.includes(currentItem.path) ? 'selected' : ''}`}>
                <ImageCanvas 
                  src={`/api/image?path=${encodeURIComponent(currentItem.path)}`} 
                  scale={transform.scale}
                  offset={transform.offset}
                  onTransform={(s: number, o: any) => setTransform({ scale: s, offset: o })}
                />

                <div className="meta-panel-v2">
                  <div className="meta-grid">
                    <div className={`meta-item ${currentItem.width * currentItem.height === minStats.res ? 'danger' : ''}`}>
                      <span className="label">分辨率</span>
                      <span className="value">{currentItem.resolution}</span>
                    </div>
                    <div className={`meta-item ${currentItem.size_bytes === minStats.size ? 'danger' : ''}`}>
                      <span className="label">大小</span>
                      <span className="value">{currentItem.size_human}</span>
                    </div>
                    <div className={`meta-item ${minStats.hasDifferentModified ? 'danger' : ''}`}>
                      <span className="label">修改日期</span>
                      <span className="value">{currentItem.modified_at}</span>
                    </div>
                  </div>
                  <div className="meta-item path-item">
                    <span className="label">路径</span>
                    <div className="value">
                      <HighlightPath path={currentItem.path} allPaths={currentCluster.items.map(i => i.path)} />
                    </div>
                  </div>
                  
                  <div className="cluster-thumbnails">
                    {currentCluster.items.map((item, idx) => (
                      <div 
                        key={idx} 
                        className={`thumb-item ${idx === innerIndex ? 'active' : ''} ${deletes[currentCluster.id]?.includes(item.path) ? 'delete-marked' : ''}`}
                        onClick={() => setInnerIndex(idx)}
                      >
                        <img src={`/api/image?path=${encodeURIComponent(item.path)}`} alt="thumb" />
                        {deletes[currentCluster.id]?.includes(item.path) && <div className="delete-dot" />}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="empty-state">
            <Search size={64} opacity={0.1} />
            <p>扫描完成后，将在此开启沉浸式比对</p>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
