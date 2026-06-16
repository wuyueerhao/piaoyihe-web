import { PDFDocument, rgb } from 'pdf-lib';

export type LayoutConfig = {
  orientation: 'landscape' | 'portrait';
  rows: number;
  cols: number;
};

export const LAYOUT_MAP: Record<string, LayoutConfig> = {
  '横向 2x2': { orientation: 'landscape', rows: 2, cols: 2 },
  '横向 2x4': { orientation: 'landscape', rows: 2, cols: 4 },
  '竖向 1x2': { orientation: 'portrait', rows: 2, cols: 1 },
  '竖向 1x3': { orientation: 'portrait', rows: 3, cols: 1 },
  '竖向 2x4': { orientation: 'portrait', rows: 4, cols: 2 },
};

const A4_PORTRAIT_WIDTH = 595.28;
const A4_PORTRAIT_HEIGHT = 841.89;

/**
 * 绘制虚线辅助函数
 */
function drawDashedLine(
  page: any,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  dashLength = 5,
  gapLength = 3,
  color = rgb(0.7, 0.7, 0.7)
) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.sqrt(dx * dx + dy * dy);
  
  if (length === 0) return;
  
  const ux = dx / length;
  const uy = dy / length;
  
  let current = 0;
  let isDash = true;
  
  while (current < length) {
    if (isDash) {
      const segEnd = Math.min(current + dashLength, length);
      page.drawLine({
        start: { x: x1 + ux * current, y: y1 + uy * current },
        end: { x: x1 + ux * segEnd, y: y1 + uy * segEnd },
        thickness: 0.5,
        color,
      });
      current = segEnd;
    } else {
      current = Math.min(current + gapLength, length);
    }
    isDash = !isDash;
  }
}

/**
 * 合并排版 PDF
 * @param pdfFiles 用户上传的 PDF 文件列表
 * @param layoutKey 布局配置名称
 * @param duplicate 是否一式两份
 * @returns 组合后 PDF 的 Uint8Array 字节数组
 */
export async function mergePdfs(pdfFiles: File[], layoutKey: string, duplicate: boolean = false): Promise<Uint8Array> {
  const layout = LAYOUT_MAP[layoutKey] || LAYOUT_MAP['横向 2x2'];
  const outputDoc = await PDFDocument.create();
  
  const margin = 20;
  const gap = 5;
  const isLandscape = layout.orientation === 'landscape';
  
  const pageW = isLandscape ? A4_PORTRAIT_HEIGHT : A4_PORTRAIT_WIDTH;
  const pageH = isLandscape ? A4_PORTRAIT_WIDTH : A4_PORTRAIT_HEIGHT;
  
  const availableWidth = pageW - 2 * margin;
  const availableHeight = pageH - 2 * margin;
  
  let currentPage = null;
  let pageCount = 0;
  
  // 遍历所有文件
  for (const file of pdfFiles) {
    const fileBytes = await file.arrayBuffer();
    const doc = await PDFDocument.load(fileBytes);
    const pages = doc.getPages();
    
    // 遍历每个文件的所有页面
    for (let i = 0; i < pages.length; i++) {
      const itemsPerPage = layout.rows * layout.cols;
      
      // 如果开启了一式两份，则把此页面嵌入两次
      const iterations = duplicate ? 2 : 1;
      
      for (let d = 0; d < iterations; d++) {
        // 创建新页
        if (pageCount % itemsPerPage === 0) {
          currentPage = outputDoc.addPage([pageW, pageH]);
          pageCount = 0;
          
          // 绘制分割线
          if (itemsPerPage > 1) {
            const cellW = availableWidth / layout.cols;
            const cellH = availableHeight / layout.rows;
            
            // 垂直分割线
            for (let c = 1; c < layout.cols; c++) {
              const x = margin + c * cellW;
              drawDashedLine(currentPage, x, margin, x, margin + availableHeight);
            }
            // 水平分割线
            for (let r = 1; r < layout.rows; r++) {
              const y = margin + r * cellH;
              drawDashedLine(currentPage, margin, y, margin + availableWidth, y);
            }
          }
        }
        
        const row = Math.floor(pageCount / layout.cols);
        const col = pageCount % layout.cols;
        
        const cellWidth = availableWidth / layout.cols;
        const cellHeight = availableHeight / layout.rows;
        
        const x = margin + col * cellWidth;
        const yTop = pageH - margin - row * cellHeight;
        const yBottom = yTop - cellHeight;
        
        const srcPage = pages[i];
        const embeddedPage = await outputDoc.embedPage(srcPage);
        
        const srcWidth = embeddedPage.width;
        const srcHeight = embeddedPage.height;
        
        const scaleX = (cellWidth - gap) / srcWidth;
        const scaleY = (cellHeight - gap) / srcHeight;
        const scale = Math.min(scaleX, scaleY);
        
        const finalWidth = srcWidth * scale;
        const finalHeight = srcHeight * scale;
        
        const offsetX = (cellWidth - finalWidth) / 2;
        const offsetY = (cellHeight - finalHeight) / 2;
        
        currentPage!.drawPage(embeddedPage, {
          x: x + offsetX,
          y: yBottom + offsetY,
          width: finalWidth,
          height: finalHeight,
        });
        
        pageCount++;
      }
    }
  }
  
  return await outputDoc.save();
}
