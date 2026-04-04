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
  MousePointer2,
  Keyboard
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
  const [directories, setDirectories] = useState<string>('');
  const [method, setMethod] = useState('cnn');
  const [threshold, setThreshold] = useState(0.95);
  const [recursive, setRecursive] = useState(true);
  
  const [status, setStatus] = useState<ScanStatus>({
    status: 'idle', progress: 0, total: 0, current_file: '', error: ''
  });
  
  const [results, setResults] = useState<Cluster[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [innerIndex, setInnerIndex] = useState(0); // 组内当前图片索引
  const [keeps, setKeeps] = useState<Record<number, string[]>>({}); // clusterId -> keepPaths[]
  const [destination, setDestination] = useState('');
  
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
  }, [currentCluster, currentIndex, innerIndex, results, keeps]);

  const handleToggleSelect = (path: string) => {
    setKeeps(prev => {
      const currentKeeps = prev[currentCluster.id] || [];
      if (currentKeeps.includes(path)) {
        return { ...prev, [currentCluster.id]: currentKeeps.filter(p => p !== path) };
      } else {
        return { ...prev, [currentCluster.id]: [...currentKeeps, path] };
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
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws/status`;
    ws.current = new WebSocket(wsUrl);
    ws.current.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === 'progress') setStatus(prev => ({ ...prev, ...data }));
    };
  };

  useEffect(() => {
    connectWS();
    return () => ws.current?.close();
  }, []);

  const startScan = async () => {
    setResults([]);
    setCurrentIndex(0);
    setInnerIndex(0);
    const dirs = directories.split('\n').filter(d => d.trim());
    if (dirs.length === 0) return alert('请输入至少一个目录');
    
    try {
      await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directories: dirs, method, threshold, recursive })
      });
    } catch (e) { alert('启动扫描失败'); }
  };

  const fetchResults = async () => {
    const res = await fetch('/api/results');
    const data = await res.json();
    setResults(data);
    const newKeeps: Record<number, string[]> = {};
    // 默认保留第一个
    data.forEach((c: Cluster) => { newKeeps[c.id] = [c.items[0].path]; });
    setKeeps(newKeeps);
  };

  useEffect(() => {
    let timer: number;
    if (status.status === 'scanning' || status.status === 'clustering') {
      timer = window.setInterval(async () => {
        const res = await fetch('/api/status');
        const data = await res.json();
        setStatus(data);
        if (data.status === 'finished') {
          clearInterval(timer);
          fetchResults();
        }
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [status.status]);

  const handleMove = async () => {
    if (!destination) return alert('请输入目标备份目录');
    const toMove: string[] = [];
    results.forEach(cluster => {
      const keptPaths = keeps[cluster.id] || [];
      cluster.items.forEach(item => { 
        if (!keptPaths.includes(item.path)) {
          toMove.push(item.path); 
        }
      });
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
    } catch (e) { alert('移动失败'); }
  };

  // 查找最小属性
  const minStats = useMemo(() => {
    if (!currentCluster) return { size: 0, res: 0 };
    return {
      size: Math.min(...currentCluster.items.map(i => i.size_bytes)),
      res: Math.min(...currentCluster.items.map(i => i.width * i.height))
    };
  }, [currentCluster]);

  const currentItem = currentCluster?.items[innerIndex];

  return (
    <div className="app-container">
      <aside className="sidebar">
        <div className="logo">
          <Search size={24} color="#3b82f6" />
          <span>ImageDedup UI</span>
        </div>
        
        <div className="section">
          <h3><FolderOpen size={16} /> 扫描配置</h3>
          <div className="field">
            <label>目标目录</label>
            <textarea value={directories} onChange={e => setDirectories(e.target.value)} placeholder="D:\Photos" />
          </div>
          <div className="field">
            <label>算法</label>
            <select value={method} onChange={e => setMethod(e.target.value)}>
              <option value="cnn">CNN (推荐)</option>
              <option value="phash">PHash</option>
              <option value="dhash">DHash</option>
            </select>
          </div>
          <div className="field">
            <label>相似度阈值 ({threshold})</label>
            <input type="range" min="0.8" max="1.0" step="0.01" value={threshold} onChange={e => setThreshold(parseFloat(e.target.value))} />
          </div>
          <button className="btn-primary" onClick={startScan} disabled={status.status === 'scanning' || status.status === 'clustering'}>
            {status.status === 'scanning' ? <Loader2 className="spin" /> : <Search size={18} />} 开始扫描
          </button>
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
                  已选 {keeps[currentCluster.id]?.length || 0} / {currentCluster.items.length}
                </div>
                
                <button 
                  className={`btn-sidebar-action btn-keep-toggle ${keeps[currentCluster.id]?.includes(currentItem.path) ? 'active' : ''}`}
                  onClick={() => handleToggleSelect(currentItem.path)}
                >
                  <CheckCircle2 size={18} /> 
                  {keeps[currentCluster.id]?.includes(currentItem.path) ? '取消保留' : '勾选保留'}
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
        {status.status === 'scanning' || status.status === 'clustering' ? (
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
                <span><span className="shortcut-key">Space/Enter</span> 勾选保留</span>
              </div>
            </header>

            <div className="compare-viewport single-mode">
              <div className={`compare-item-v2 ${keeps[currentCluster.id]?.includes(currentItem.path) ? 'selected' : ''}`}>
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
                        className={`thumb-item ${idx === innerIndex ? 'active' : ''} ${keeps[currentCluster.id]?.includes(item.path) ? 'kept' : ''}`}
                        onClick={() => setInnerIndex(idx)}
                      >
                        <img src={`/api/image?path=${encodeURIComponent(item.path)}`} alt="thumb" />
                        {keeps[currentCluster.id]?.includes(item.path) && <div className="kept-dot" />}
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
