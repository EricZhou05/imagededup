import { useState, useEffect, useRef } from 'react';
import { 
  Settings, 
  Search, 
  FolderOpen, 
  Trash2, 
  CheckCircle2, 
  ChevronRight, 
  Maximize2, 
  Info,
  Loader2,
  AlertCircle,
  ArrowRightLeft
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

function App() {
  const [directories, setDirectories] = useState<string>('');
  const [method, setMethod] = useState('cnn');
  const [threshold, setThreshold] = useState(0.95);
  const [recursive, setRecursive] = useState(true);
  
  const [status, setStatus] = useState<ScanStatus>({
    status: 'idle',
    progress: 0,
    total: 0,
    current_file: '',
    error: ''
  });
  
  const [results, setResults] = useState<Cluster[]>([]);
  const [visibleCount, setVisibleCount] = useState(20);
  const [selectedCluster, setSelectedCluster] = useState<Cluster | null>(null);
  const [keeps, setKeeps] = useState<Record<number, string>>({}); // clusterId -> keepPath
  const [destination, setDestination] = useState('');
  
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    connectWS();
    return () => ws.current?.close();
  }, []);

  const connectWS = () => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws/status`;
    
    ws.current = new WebSocket(wsUrl);
    ws.current.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'progress') {
        setStatus(prev => ({
          ...prev,
          status: data.status,
          progress: data.progress,
          total: data.total,
          current_file: data.filename
        }));
      }
    };
    ws.current.onclose = () => {
      setTimeout(connectWS, 3000);
    };
  };

  const startScan = async () => {
    setResults([]);
    const dirs = directories.split('\n').filter(d => d.trim());
    if (dirs.length === 0) return alert('请输入至少一个目录');
    
    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          directories: dirs,
          method,
          threshold,
          recursive
        })
      });
      const data = await res.json();
      if (data.error) alert(data.error);
    } catch (e) {
      alert('启动扫描失败');
    }
  };

  const fetchResults = async () => {
    const res = await fetch('/api/results');
    const data = await res.json();
    setResults(data);
    
    // 默认保留每组第一个
    const newKeeps: Record<number, string> = {};
    data.forEach((c: Cluster) => {
      newKeeps[c.id] = c.items[0].path;
    });
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
      const keep = keeps[cluster.id];
      cluster.items.forEach(item => {
        if (item.path !== keep) {
          toMove.push(item.path);
        }
      });
    });
    
    if (toMove.length === 0) return alert('没有需要移动的文件');
    if (!confirm(`确定移动 ${toMove.length} 个文件到 ${destination} 吗？`)) return;
    
    try {
      const res = await fetch('/api/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: toMove,
          destination
        })
      });
      const data = await res.json();
      alert(`成功移动 ${data.moved.length} 个文件，错误 ${data.errors.length} 个`);
      fetchResults(); // 刷新结果
    } catch (e) {
      alert('移动文件失败');
    }
  };

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
            <label>目标目录 (每行一个)</label>
            <textarea 
              value={directories} 
              onChange={e => setDirectories(e.target.value)}
              placeholder="D:\Photos\Anime"
            />
          </div>
          
          <div className="field">
            <label>算法</label>
            <select value={method} onChange={e => setMethod(e.target.value)}>
              <option value="cnn">CNN (深度学习 - 推荐)</option>
              <option value="phash">PHash (感知哈希)</option>
              <option value="dhash">DHash (差异哈希)</option>
            </select>
          </div>
          
          <div className="field">
            <label>相似度阈值 ({threshold})</label>
            <input 
              type="range" min="0.8" max="1.0" step="0.01" 
              value={threshold} onChange={e => setThreshold(parseFloat(e.target.value))}
            />
            <small>二次元建议 0.95 以上</small>
          </div>

          <div className="field checkbox">
            <input type="checkbox" checked={recursive} onChange={e => setRecursive(e.target.checked)} id="recursive" />
            <label htmlFor="recursive">递归子目录</label>
          </div>
          
          <button 
            className="btn-primary" 
            onClick={startScan} 
            disabled={status.status === 'scanning' || status.status === 'clustering'}
          >
            {status.status === 'scanning' ? <Loader2 className="spin" /> : <Search size={18} />}
            开始扫描
          </button>
        </div>

        {results.length > 0 && (
          <div className="section">
            <h3><Trash2 size={16} /> 处理操作</h3>
            <div className="field">
              <label>重复文件备份至</label>
              <input 
                type="text" 
                value={destination} 
                onChange={e => setDestination(e.target.value)}
                placeholder="D:\DuplicatesBackup"
              />
            </div>
            <button className="btn-danger" onClick={handleMove}>
              <ArrowRightLeft size={18} /> 执行移动
            </button>
          </div>
        )}
      </aside>

      <main className="main-content">
        {status.status === 'idle' && results.length === 0 && (
          <div className="empty-state">
            <Search size={64} opacity={0.2} />
            <p>准备就绪，请在左侧配置扫描目录</p>
          </div>
        )}

        {(status.status === 'scanning' || status.status === 'clustering') && (
          <div className="progress-overlay">
            <div className="progress-card">
              <h2>{status.status === 'scanning' ? '正在分析特征...' : '正在计算相似度...'}</h2>
              <div className="progress-bar-bg">
                <div 
                  className="progress-bar-fill" 
                  style={{ width: `${(status.progress / (status.total || 1)) * 100}%` }}
                />
              </div>
              <p>{status.progress} / {status.total}</p>
              <div className="current-file">{status.current_file}</div>
            </div>
          </div>
        )}

        {results.length > 0 && (
          <div className="results-view">
            <header className="results-header">
              <h2>检测到 {results.length} 组疑似重复</h2>
              <p>共包含 {results.reduce((acc, c) => acc + c.items.length, 0)} 张图片</p>
            </header>
            
            <div className="cluster-grid">
              {results.slice(0, visibleCount).map(cluster => (
                <div key={cluster.id} className="cluster-card" onClick={() => setSelectedCluster(cluster)}>
                  <div className="cluster-previews">
                    {cluster.items.slice(0, 3).map((item, idx) => (
                      <img key={idx} src={`/api/image?path=${encodeURIComponent(item.path)}`} alt="preview" loading="lazy" />
                    ))}
                    {cluster.items.length > 3 && <div className="more">+{cluster.items.length - 3}</div>}
                  </div>
                  <div className="cluster-info">
                    <span>{cluster.items.length} 张相似</span>
                    <Maximize2 size={16} />
                  </div>
                </div>
              ))}
            </div>

            {visibleCount < results.length && (
              <div className="load-more">
                <button className="btn-secondary" onClick={() => setVisibleCount(prev => prev + 20)}>
                  加载更多 ({results.length - visibleCount} 组待查看)
                </button>
              </div>
            )}
          </div>
        )}
      </main>

      {selectedCluster && (
        <div className="modal-overlay" onClick={() => setSelectedCluster(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <header className="modal-header">
              <h3>重复组详情</h3>
              <button onClick={() => setSelectedCluster(null)}>×</button>
            </header>
            
            <div className="comparison-container">
              {selectedCluster.items.map((item, idx) => {
                const isKeep = keeps[selectedCluster.id] === item.path;
                return (
                  <div key={idx} className={`comparison-item ${isKeep ? 'keep' : ''}`}>
                    <div className="image-wrapper">
                      <img src={`/api/image?path=${encodeURIComponent(item.path)}`} alt="full" />
                      <div className="zoom-hint">悬停放大比对</div>
                    </div>
                    
                    <div className="item-meta">
                      <div className="meta-row">
                        <span className="label">分辨率</span>
                        <span className="value">{item.resolution}</span>
                      </div>
                      <div className="meta-row">
                        <span className="label">大小</span>
                        <span className="value">{item.size_human}</span>
                      </div>
                      <div className="meta-row path">
                        <span className="label">路径</span>
                        <span className="value" title={item.path}>{item.path}</span>
                      </div>
                    </div>
                    
                    <button 
                      className={`btn-keep ${isKeep ? 'active' : ''}`}
                      onClick={() => setKeeps({ ...keeps, [selectedCluster.id]: item.path })}
                    >
                      {isKeep ? <CheckCircle2 size={18} /> : null}
                      {isKeep ? '保留此张' : '设为保留'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
