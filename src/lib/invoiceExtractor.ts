import * as pdfjsLib from 'pdfjs-dist';

// 配置 PDF.js Worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.mjs`;

export interface InvoiceInfo {
  amount: number;
  invoiceDate: string;
  invoiceType: string;
  productType: string;
  buyerName: string;
  sellerName: string;
  fileName: string;
  invoiceNumber: string;
  taxAmount: number;
}

export async function extractInvoiceInfo(file: File): Promise<InvoiceInfo> {
  const arrayBuffer = await file.arrayBuffer();
  
  // 默认值
  const info: InvoiceInfo = {
    amount: 0.0,
    invoiceDate: new Date(file.lastModified).toISOString().split('T')[0],
    invoiceType: '普票',
    productType: '商品',
    buyerName: '购买方',
    sellerName: '销售方',
    fileName: file.name,
    invoiceNumber: '-',
    taxAmount: 0.0
  };

  try {
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    
    // 只读取第一页
    const page = await pdf.getPage(1);
    const textContent = await page.getTextContent();
    const textItems = textContent.items.map((item: any) => item.str);
    const fullText = textItems.join('');
    
    // 发票类型识别
    if (fullText.includes('专用发票')) info.invoiceType = '专票';
    else if (fullText.includes('普通发票')) info.invoiceType = '普票';
    else if (fullText.includes('电子发票')) info.invoiceType = '电票';
    
    // 开票日期
    const dateMatch = fullText.match(/(?:开票日期|日期)[：:]?\s*(\d{4})\s*年\s*(\d{2})\s*月\s*(\d{2})\s*日/);
    if (dateMatch) {
      info.invoiceDate = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
    } else {
      const dateMatch2 = fullText.match(/(?:开票日期|日期)[：:]?\s*(\d{4}-\d{2}-\d{2})/);
      if (dateMatch2) info.invoiceDate = dateMatch2[1];
    }
    
    // 金额 (价税合计/小写)
    // 寻找类似 (小写) ¥123.45 或 ￥123.45
    const amountMatch = fullText.match(/[¥￥]\s*([\d,]+\.\d{2})/);
    if (amountMatch) {
      info.amount = parseFloat(amountMatch[1].replace(/,/g, ''));
    }
    
    // 发票号码
    const numberMatch = fullText.match(/号码[：:]?\s*(\d{8,20})/);
    if (numberMatch) info.invoiceNumber = numberMatch[1];
    
    // 税额
    const taxMatch = fullText.match(/税\s*额\s*[¥￥]?\s*([\d,]+\.\d{2})/);
    if (taxMatch) {
      info.taxAmount = parseFloat(taxMatch[1].replace(/,/g, ''));
    }
    
    // 购买方 (常常在 "购买方" 或 "名称：" 之后)
    const buyerIdx = fullText.indexOf('购买方');
    if (buyerIdx !== -1) {
      const buyerStr = fullText.substring(buyerIdx, buyerIdx + 100);
      const nameMatch = buyerStr.match(/名称[：:]\s*([^信用代码\d]+)/);
      if (nameMatch) info.buyerName = nameMatch[1].trim();
    }
    
    // 销售方
    const sellerIdx = fullText.indexOf('销售方');
    if (sellerIdx !== -1) {
      const sellerStr = fullText.substring(sellerIdx, sellerIdx + 100);
      const nameMatch = sellerStr.match(/名称[：:]\s*([^信用代码\d]+)/);
      if (nameMatch) info.sellerName = nameMatch[1].trim();
    }
    
    // 商品名称
    const productMatch = fullText.match(/\*([^*]+)\*/);
    if (productMatch) {
      info.productType = productMatch[1].trim();
    }
    
  } catch (error) {
    console.error(`解析 PDF [${file.name}] 失败:`, error);
  }

  return info;
}
