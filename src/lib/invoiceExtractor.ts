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
    const loadingTask = pdfjsLib.getDocument({ 
      data: arrayBuffer,
      cMapUrl: `/cmaps/`,
      cMapPacked: true,
    });
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
    const dateMatch = cleanText.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
    if (dateMatch) {
      info.invoiceDate = `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}`;
    } else {
      const dateMatch2 = cleanText.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
      if (dateMatch2) info.invoiceDate = `${dateMatch2[1]}-${dateMatch2[2].padStart(2, '0')}-${dateMatch2[3].padStart(2, '0')}`;
    }
    
    // 金额 (价税合计/小写)
    const amountMatch = cleanText.match(/(?:小写|价税合计)[^\d¥￥]{0,10}[¥￥]?(\d{1,10}\.\d{2})/);
    if (amountMatch) {
      info.amount = parseFloat(amountMatch[1]);
    } else {
      // Fallback
      const allMoney = [...cleanText.matchAll(/[¥￥](\d{1,10}\.\d{2})/g)].map(m => parseFloat(m[1]));
      if (allMoney.length > 0) info.amount = Math.max(...allMoney);
    }
    
    // 发票号码
    const numberMatch = cleanText.match(/(?:发票号码|号码)[：:]?(\d{8,24})/);
    if (numberMatch) {
      info.invoiceNumber = numberMatch[1];
    } else {
      const digit20Match = cleanText.match(/(?<!\d)(\d{20})(?!\d)/);
      if (digit20Match) {
        info.invoiceNumber = digit20Match[1];
      } else {
        const filenameMatch = file.name.match(/(\d{16,24})/);
        if (filenameMatch) info.invoiceNumber = filenameMatch[1];
      }
    }
    
    // 税额
    const taxMatch = cleanText.match(/(?:合计税额|税额合计|税额)[^\d¥￥]{0,10}[¥￥]?(\d{1,10}\.\d{2})/);
    if (taxMatch) {
      info.taxAmount = parseFloat(taxMatch[1]);
    }
    
    // 购买方与销售方 - 三重策略
    const companyKeywords = ['公司', '企业', '股份', '有限', '集团', '厂', '店', '中心', '工作室', '合作社', '委员会'];
    
    const extractName = (prefix: string) => {
      // 策略1: 匹配区域前缀 (购买方/销售方)
      const areaPattern = new RegExp(`${prefix}[^名]{0,20}名称[：:]([\\u4e00-\\u9fa5a-zA-Z0-9（）()]{4,30})`);
      const areaMatch = cleanText.match(areaPattern);
      if (areaMatch) return areaMatch[1];
      
      return null;
    };

    let buyer = extractName('购买方') || extractName('购');
    let seller = extractName('销售方') || extractName('销');

    if (!buyer || !seller) {
      // 策略2 & 3: 提取所有符合条件的名称
      const nameMatches = [...cleanText.matchAll(/名称[：:]([\\u4e00-\\u9fa5a-zA-Z0-9（）()]{4,30})/g)].map(m => m[1]);
      const validNames = nameMatches.filter(name => companyKeywords.some(k => name.includes(k)));
      
      if (validNames.length >= 2) {
        if (!buyer) buyer = validNames[0];
        if (!seller) seller = validNames[1];
      } else {
        const companies = [...cleanText.matchAll(/([\\u4e00-\\u9fa5a-zA-Z0-9（）()]{2,30}(?:公司|企业|股份|有限|集团|厂|店|中心|工作室|合作社|委员会))/g)].map(m => m[1]);
        const uniqueCompanies = Array.from(new Set(companies));
        if (!buyer && uniqueCompanies.length > 0) buyer = uniqueCompanies[0];
        if (!seller && uniqueCompanies.length > 1) seller = uniqueCompanies[1];
      }
    }
    
    if (buyer) info.buyerName = buyer;
    if (seller) info.sellerName = seller;
    
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
