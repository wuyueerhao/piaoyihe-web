import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerSrc from 'pdfjs-dist/build/pdf.worker.mjs?url';

// 配置 PDF.js Worker
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

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
    const rawText = textItems.join('');
    const cleanText = rawText.replace(/\s+/g, '');
    
    // 发票类型识别
    if (cleanText.includes('专用发票')) info.invoiceType = '专票';
    else if (cleanText.includes('普通发票')) info.invoiceType = '普票';
    else if (cleanText.includes('电子发票') || cleanText.includes('数电发票') || cleanText.includes('全电发票')) info.invoiceType = '电票';
    
    // 开票日期
    const dateMatch = cleanText.match(/(?:开票日期|日期)[：:]?(\d{4})年(\d{2})月(\d{2})日/);
    if (dateMatch) {
      info.invoiceDate = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
    } else {
      const dateMatch2 = cleanText.match(/(?:开票日期|日期)[：:]?(\d{4}-\d{2}-\d{2})/);
      if (dateMatch2) info.invoiceDate = dateMatch2[1];
    }
    
    // 金额 (价税合计/小写)
    const amountMatch = cleanText.match(/(?:小写|价税合计).*?[¥￥]?(\d{1,10}\.\d{2})/);
    if (amountMatch) {
      info.amount = parseFloat(amountMatch[1]);
    } else {
      // Fallback
      const allMoney = [...cleanText.matchAll(/[¥￥](\d{1,10}\.\d{2})/g)].map(m => parseFloat(m[1]));
      if (allMoney.length > 0) info.amount = Math.max(...allMoney);
    }
    
    // 发票号码
    const numberMatch = cleanText.match(/(?:发票号码|号码)[：:]?(\d{8,24})/);
    if (numberMatch) info.invoiceNumber = numberMatch[1];
    
    // 税额
    const taxMatch = cleanText.match(/(?:合计税额|税额合计|税额).*?[¥￥]?(\d{1,10}\.\d{2})/);
    if (taxMatch) {
      info.taxAmount = parseFloat(taxMatch[1]);
    }
    
    // 购买方
    const buyerMatch = cleanText.match(/(?:购买方|受票方|购方)(?:信息)?(?:名称)?[：:]?([^统纳码区密]+)/);
    if (buyerMatch && buyerMatch[1].length > 1) {
       info.buyerName = buyerMatch[1].replace(/名称[：:]?/, '').substring(0, 30);
    } else {
       const fallbackMatch = cleanText.match(/([\u4e00-\u9fa5A-Za-z0-9()（）]{2,30}(?:公司|厂|院|局|所|部|中心|行|合作社|委员会))/);
       if (fallbackMatch) info.buyerName = fallbackMatch[1];
    }
    
    // 销售方
    const sellerMatch = cleanText.match(/(?:销售方|销方|开票方)(?:信息)?(?:名称)?[：:]?([^统纳码区密]+)/);
    if (sellerMatch && sellerMatch[1].length > 1) {
       info.sellerName = sellerMatch[1].replace(/名称[：:]?/, '').substring(0, 30);
    }
    
    // 商品名称
    const productMatch = cleanText.match(/\*([^*]+)\*/);
    if (productMatch) {
      info.productType = productMatch[1].trim();
    }
    
    console.log("PDF Extracted:", { raw: rawText, clean: cleanText, result: info });
    
  } catch (error) {
    console.error(`解析 PDF [${file.name}] 失败:`, error);
  }

  return info;
}
