import React, { useState, useCallback, useRef, useEffect } from 'react';
import { UploadCloud, Trash2, Settings, Download, Loader2, ArrowUp, ArrowDown, FileSymlink, XCircle, RefreshCw, Eye } from 'lucide-react';
import JSZip from 'jszip';
import { extractInvoiceInfo } from './lib/invoiceExtractor';
import type { InvoiceInfo } from './lib/invoiceExtractor';
import { mergePdfs, LAYOUT_MAP } from './lib/pdfMerger';
import './index.css';

type FileItem = {
  id: string;
  file: File;
  info: InvoiceInfo | null;
  status: 'loading' | 'success' | 'error';
  selected: boolean;
};

function App() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [layout, setLayout] = useState('横向 2x2');
  const [duplicate, setDuplicate] = useState(false);
  
  const [isMerging, setIsMerging] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  
  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [renameRule, setRenameRule] = useState('{开票日期}-{购买方}-{金额}');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- File Processing ---
  const processFiles = async (newFiles: File[]) => {
    const pdfFiles = newFiles.filter(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    if (pdfFiles.length === 0) return;

    const items: FileItem[] = pdfFiles.map(file => ({
      id: Math.random().toString(36).substring(7),
      file,
      info: null,
      status: 'loading',
      selected: false
    }));

    setFiles(prev => [...prev, ...items]);

    for (const item of items) {
      try {
        const info = await extractInvoiceInfo(item.file);
        setFiles(prev => prev.map(f => f.id === item.id ? { ...f, info, status: 'success' } : f));
      } catch (err) {
        setFiles(prev => prev.map(f => f.id === item.id ? { ...f, status: 'error' } : f));
      }
    }
  };

  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); }, []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    if (e.dataTransfer.files?.length) processFiles(Array.from(e.dataTransfer.files));
  }, []);

  // --- Real-time Preview ---
  useEffect(() => {
    let active = true;
    const updatePreview = async () => {
      if (files.length === 0) {
        setPreviewUrl(null);
        return;
      }
      // Only preview if at least one file is fully loaded
      const validFiles = files.filter(f => f.status === 'success' || f.status === 'error').map(f => f.file);
      if (validFiles.length === 0) return;

      setIsPreviewLoading(true);
      try {
        const pdfBytes = await mergePdfs(validFiles, layout, duplicate);
        if (!active) return;
        const blob = new Blob([pdfBytes as BlobPart], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        setPreviewUrl(prev => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
      } catch (e) {
        console.error("Preview generation failed", e);
      } finally {
        if (active) setIsPreviewLoading(false);
      }
    };

    const timer = setTimeout(updatePreview, 500); // Debounce
    return () => { active = false; clearTimeout(timer); };
  }, [files, layout, duplicate]);

  // --- Table Actions ---
  const toggleSelect = (id: string) => {
    setFiles(prev => prev.map(f => f.id === id ? { ...f, selected: !f.selected } : f));
  };
  const toggleSelectAll = () => {
    const allSelected = files.every(f => f.selected);
    setFiles(prev => prev.map(f => ({ ...f, selected: !allSelected })));
  };

  const moveUp = () => {
    const idx = files.findIndex(f => f.selected);
    if (idx > 0) {
      const newFiles = [...files];
      [newFiles[idx - 1], newFiles[idx]] = [newFiles[idx], newFiles[idx - 1]];
      setFiles(newFiles);
    }
  };

  const moveDown = () => {
    const idx = files.findIndex(f => f.selected);
    if (idx !== -1 && idx < files.length - 1) {
      const newFiles = [...files];
      [newFiles[idx + 1], newFiles[idx]] = [newFiles[idx], newFiles[idx + 1]];
      setFiles(newFiles);
    }
  };

  const deleteSelected = () => setFiles(prev => prev.filter(f => !f.selected));
  const clearAll = () => setFiles([]);

  const sortByDate = () => {
    setFiles(prev => [...prev].sort((a, b) => {
      const da = a.info?.invoiceDate || '0';
      const db = b.info?.invoiceDate || '0';
      return da.localeCompare(db);
    }));
  };

  const sortByAmount = () => {
    setFiles(prev => [...prev].sort((a, b) => (b.info?.amount || 0) - (a.info?.amount || 0)));
  };

  const exportCSV = () => {
    const headers = "文件名,发票类型,商品名称,开票日期,金额,购买方,销售方\n";
    const rows = files.map(f => {
      const i = f.info;
      return i ? `"${f.file.name}","${i.invoiceType}","${i.productType}","${i.invoiceDate}","${i.amount}","${i.buyerName}","${i.sellerName}"` 
               : `"${f.file.name}",解析失败,,,,,`;
    }).join("\n");
    
    const blob = new Blob(['\uFEFF' + headers + rows], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "发票明细导出.csv";
    link.click();
  };

  const downloadRenamedZip = async () => {
    const zip = new JSZip();
    for (const f of files) {
      if (f.info) {
        let newName = renameRule
          .replace('{开票日期}', f.info.invoiceDate)
          .replace('{购买方}', f.info.buyerName)
          .replace('{销售方}', f.info.sellerName)
          .replace('{金额}', f.info.amount.toString())
          .replace('{类型}', f.info.invoiceType);
        newName = newName.replace(/[\\/:*?"<>|]/g, '_') + '.pdf';
        zip.file(newName, f.file);
      } else {
        zip.file(`未解析_${f.file.name}`, f.file);
      }
    }
    const content = await zip.generateAsync({ type: "blob" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(content);
    link.download = "重命名发票打包.zip";
    link.click();
    setRenameModalOpen(false);
  };

  const handleMergeDownload = async () => {
    if (files.length === 0) return;
    setIsMerging(true);
    try {
      const pdfBytes = await mergePdfs(files.map(f => f.file), layout, duplicate);
      const blob = new Blob([pdfBytes as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `合并发票_${new Date().getTime()}.pdf`;
      link.click();
    } catch (error) {
      alert('合并失败');
    } finally {
      setIsMerging(false);
    }
  };

  const totalAmount = files.reduce((sum, f) => sum + (f.info?.amount || 0), 0);

  return (
    <div className="app-layout">
      {/* Header */}
      <header className="header">
        <div className="header-title">
          <h1>票易合 SaaS</h1>
          <span className="header-version">v2.0 Pro</span>
        </div>
        <div>
          <button className="btn btn-outline" onClick={exportCSV} disabled={files.length === 0}>
            <Download size={16}/> 导出明细 (CSV)
          </button>
        </div>
      </header>

      <div className="main-container">
        {/* Left Workspace */}
        <div className="left-panel">
          <div 
            className={`upload-strip ${isDragging ? 'dragging' : ''}`}
            onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input type="file" multiple accept="application/pdf" style={{ display: 'none' }} ref={fileInputRef} onChange={e => { if (e.target.files) processFiles(Array.from(e.target.files)) }} />
            <UploadCloud size={24} />
            <span>拖拽 PDF 发票到此处，或点击浏览文件...</span>
          </div>

          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 40 }}><input type="checkbox" checked={files.length > 0 && files.every(f=>f.selected)} onChange={toggleSelectAll} /></th>
                  <th>文件名</th>
                  <th>开票日期</th>
                  <th>金额</th>
                  <th>发票类型</th>
                  <th>购买方</th>
                </tr>
              </thead>
              <tbody>
                {files.length === 0 ? (
                  <tr><td colSpan={6} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>暂无数据</td></tr>
                ) : files.map((f) => (
                  <tr key={f.id} className={f.selected ? 'selected' : ''} onClick={() => toggleSelect(f.id)}>
                    <td><input type="checkbox" checked={f.selected} readOnly /></td>
                    <td title={f.file.name}>{f.status === 'loading' ? <Loader2 size={14} className="lucide-spin"/> : f.file.name}</td>
                    <td>{f.info?.invoiceDate || '-'}</td>
                    <td style={{ color: 'var(--primary-color)', fontWeight: 600 }}>{f.info ? `¥${f.info.amount.toFixed(2)}` : '-'}</td>
                    <td>{f.info?.invoiceType || '-'}</td>
                    <td title={f.info?.buyerName}>{f.info?.buyerName || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="toolbar">
            <button className="btn btn-outline" onClick={() => fileInputRef.current?.click()}><UploadCloud size={16}/> 添加</button>
            <button className="btn btn-outline btn-danger" onClick={deleteSelected}><Trash2 size={16}/> 删除</button>
            <button className="btn btn-outline btn-danger" onClick={clearAll}><XCircle size={16}/> 清空</button>
            <div className="divider"></div>
            <button className="btn btn-outline" onClick={moveUp}><ArrowUp size={16}/> 上移</button>
            <button className="btn btn-outline" onClick={moveDown}><ArrowDown size={16}/> 下移</button>
            <div className="divider"></div>
            <button className="btn btn-outline" onClick={sortByDate}><RefreshCw size={16}/> 按日期排序</button>
            <button className="btn btn-outline" onClick={sortByAmount}><RefreshCw size={16}/> 按金额排序</button>
            <div className="divider"></div>
            <button className="btn btn-primary" onClick={() => setRenameModalOpen(true)} disabled={files.length === 0}><FileSymlink size={16}/> 批量重命名压缩</button>
          </div>
        </div>

        {/* Right Sidebar */}
        <div className="right-panel">
          <div className="settings-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '1rem' }}>
              <Settings size={18} color="var(--primary-color)" />
              <h3 style={{ fontSize: '1.1rem', margin: 0 }}>排版与打印设置</h3>
            </div>
            
            <div className="form-row">
              <div className="form-group">
                <label>排版布局</label>
                <select value={layout} onChange={e => setLayout(e.target.value)}>
                  {Object.keys(LAYOUT_MAP).map(k => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>附加选项</label>
                <div style={{ height: '38px', display: 'flex', alignItems: 'center' }}>
                  <label className="checkbox-label">
                    <input type="checkbox" checked={duplicate} onChange={e => setDuplicate(e.target.checked)} />
                    一式两份
                  </label>
                </div>
              </div>
            </div>

            <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--surface-border)', display: 'flex', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>发票数量</div>
                <div style={{ fontSize: '1.25rem', fontWeight: 600 }}>{files.length}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>合计金额</div>
                <div style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--primary-color)' }}>¥{totalAmount.toFixed(2)}</div>
              </div>
            </div>
          </div>

          <div className="preview-card">
            <div className="preview-header">
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Eye size={16} /> 实时预览</span>
              {isPreviewLoading && <Loader2 size={16} className="lucide-spin" color="var(--primary-color)" />}
            </div>
            <div className="preview-content">
              {previewUrl ? (
                <iframe src={`${previewUrl}#toolbar=0&view=FitH`} className="preview-iframe" title="PDF Preview" />
              ) : (
                <div className="preview-empty">
                  <Eye size={32} opacity={0.5} />
                  <span>添加文件后在此处预览排版</span>
                </div>
              )}
            </div>
          </div>

          <button className="btn btn-primary" style={{ padding: '1rem', fontSize: '1rem', justifyContent: 'center' }} onClick={handleMergeDownload} disabled={files.length === 0 || isMerging}>
            {isMerging ? <><Loader2 size={20} className="lucide-spin" /> 合并处理中...</> : <><Download size={20} /> 合并并下载 PDF</>}
          </button>
        </div>
      </div>

      {/* Rename Modal */}
      {renameModalOpen && (
        <div className="modal-overlay" onClick={() => setRenameModalOpen(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h2 className="modal-title">批量重命名压缩</h2>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
              因网页端无法直接修改本地文件，我们将为您生成一个包含所有重命名后文件的 ZIP 压缩包。
            </p>
            <div className="form-group">
              <label>命名规则模板</label>
              <input type="text" value={renameRule} onChange={e => setRenameRule(e.target.value)} />
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 8 }}>
                可用变量: {'{开票日期}'}, {'{购买方}'}, {'{销售方}'}, {'{金额}'}, {'{类型}'}
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-outline" onClick={() => setRenameModalOpen(false)}>取消</button>
              <button className="btn btn-primary" onClick={downloadRenamedZip}><Download size={16}/> 打包下载 ZIP</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .lucide-spin { animation: spin 1s linear infinite; }
      `}</style>
    </div>
  );
}

export default App;
