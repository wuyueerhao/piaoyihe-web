import React, { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { UploadCloud, File as FileIcon, Trash2, Settings, Download, Loader2 } from 'lucide-react';
import { extractInvoiceInfo } from './lib/invoiceExtractor';
import type { InvoiceInfo } from './lib/invoiceExtractor';
import { mergePdfs, LAYOUT_MAP } from './lib/pdfMerger';
import './index.css';

type FileItem = {
  id: string;
  file: File;
  info: InvoiceInfo | null;
  status: 'loading' | 'success' | 'error';
};

function App() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [layout, setLayout] = useState('横向 2x2');
  const [isMerging, setIsMerging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFiles = async (newFiles: File[]) => {
    const pdfFiles = newFiles.filter(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    
    if (pdfFiles.length === 0) {
      alert('请上传 PDF 文件！');
      return;
    }

    const items: FileItem[] = pdfFiles.map(file => ({
      id: Math.random().toString(36).substring(7),
      file,
      info: null,
      status: 'loading'
    }));

    setFiles(prev => [...prev, ...items]);

    // Parse info for each file
    for (const item of items) {
      try {
        const info = await extractInvoiceInfo(item.file);
        setFiles(prev => prev.map(f => f.id === item.id ? { ...f, info, status: 'success' } : f));
      } catch (err) {
        setFiles(prev => prev.map(f => f.id === item.id ? { ...f, status: 'error' } : f));
      }
    }
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(Array.from(e.dataTransfer.files));
    }
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(Array.from(e.target.files));
    }
  };

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id));
  };

  const handleMerge = async () => {
    if (files.length === 0) return;
    
    try {
      setIsMerging(true);
      const rawFiles = files.map(f => f.file);
      const pdfBytes = await mergePdfs(rawFiles, layout);
      
      // Download
      const blob = new Blob([pdfBytes as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `合并发票_${new Date().getTime()}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
    } catch (error) {
      console.error('合并失败', error);
      alert('合并失败，请查看控制台日志');
    } finally {
      setIsMerging(false);
    }
  };

  const totalAmount = files.reduce((sum, f) => sum + (f.info?.amount || 0), 0);

  return (
    <div className="app-container">
      {/* Left Column: Upload and File List */}
      <div className="main-content">
        <div className="header">
          <h1>票易合</h1>
          <p>发票 PDF 合并排版工具 (Web 版)</p>
        </div>

        <div className="glass-panel">
          <div 
            className={`upload-area ${isDragging ? 'dragging' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input 
              type="file" 
              multiple 
              accept="application/pdf"
              style={{ display: 'none' }}
              ref={fileInputRef}
              onChange={handleFileSelect}
            />
            <UploadCloud size={48} className="upload-icon" />
            <h3>拖拽 PDF 发票到此处</h3>
            <p style={{ color: 'var(--text-muted)', marginTop: 8 }}>或点击浏览本地文件</p>
          </div>

          <div className="file-list">
            <AnimatePresence>
              {files.map(item => (
                <motion.div 
                  key={item.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="file-item"
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <FileIcon size={24} color="var(--primary-color)" />
                    <div className="file-info">
                      <span className="file-name">{item.file.name}</span>
                      {item.status === 'loading' ? (
                        <span className="file-meta" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Loader2 size={12} className="lucide-spin" /> 解析中...
                        </span>
                      ) : item.info ? (
                        <span className="file-meta">
                          {item.info.invoiceDate} | {item.info.invoiceType} | ￥{item.info.amount.toFixed(2)}
                        </span>
                      ) : (
                        <span className="file-meta" style={{ color: 'var(--danger-color)' }}>解析失败</span>
                      )}
                    </div>
                  </div>
                  <button className="btn-icon" onClick={() => removeFile(item.id)}>
                    <Trash2 size={18} />
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
            
            {files.length === 0 && (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem 0' }}>
                暂无发票，请上传
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Right Column: Settings and Action */}
      <div className="sidebar">
        <div className="glass-panel" style={{ position: 'sticky', top: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '1.5rem' }}>
            <Settings size={20} color="var(--primary-color)" />
            <h2 style={{ fontSize: '1.25rem' }}>排版设置</h2>
          </div>

          <div className="control-group">
            <label>排版布局</label>
            <select value={layout} onChange={e => setLayout(e.target.value)}>
              {Object.keys(LAYOUT_MAP).map(k => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </div>

          <div className="control-group" style={{ marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px solid var(--surface-border)' }}>
            <label>统计信息</label>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <span style={{ color: 'var(--text-muted)' }}>发票数量</span>
              <span style={{ fontWeight: 'bold' }}>{files.length} 张</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>总金额</span>
              <span style={{ fontWeight: 'bold', color: 'var(--primary-color)' }}>￥{totalAmount.toFixed(2)}</span>
            </div>
          </div>

          <button 
            className="btn-primary" 
            style={{ marginTop: '2rem' }}
            disabled={files.length === 0 || isMerging}
            onClick={handleMerge}
          >
            {isMerging ? (
              <><Loader2 size={20} className="lucide-spin" /> 合并中...</>
            ) : (
              <><Download size={20} /> 合并并下载</>
            )}
          </button>
        </div>
      </div>
      
      {/* 动画需要定义的 keyframes */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .lucide-spin {
          animation: spin 1s linear infinite;
        }
      `}</style>
    </div>
  );
}

export default App;
