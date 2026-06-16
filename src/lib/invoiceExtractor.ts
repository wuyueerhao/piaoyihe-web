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
    
    // 购买方与销售方 - 终极策略（全面兼容中英文及特殊符号）
    const companyKeywords = ['公司', '企业', '股份', '有限', '集团', '厂', '店', '中心', '工作室', '合作社', '委员会', '局', '院', '所'];
    const enKeywords = ['INC', 'CORP', 'LTD', 'LLC', 'COMPANY', 'LIMITED', 'CORPORATION', 'CO'];
    
    // 允许的名称字符集（包含中文、英文、数字、括号、连接符、&符合、点、逗号）
    const nameChars = '\\u4e00-\\u9fa5a-zA-Z0-9（）()\\-&.,';
    
    // 清理混入名称中的长串纯数字(如发票号)、税号或排版错位混入的日期和表头
    const cleanCompanyName = (name: string) => {
      let cleaned = name;
      
      // 终极杀手锏：在任何解析之前，全局强行抹除所有完整日期（20xx年xx月xx日）和隐藏的零宽字符
      cleaned = cleaned.replace(/[\\u200B-\\u200D\\uFEFF]/g, '');
      cleaned = cleaned.replace(/(?:20\\d{2}[-/.年]\\d{1,2}[-/.月]\\d{1,2}日?)/g, '');
      
      let lastCleaned = '';
      while (cleaned !== lastCleaned) {
        lastCleaned = cleaned;
        cleaned = cleaned.replace(/^[^a-zA-Z0-9\\u4e00-\\u9fa5]+/, ''); // 移除开头的杂质标点符号
        cleaned = cleaned.replace(/^(?:统一社会信用代码|纳税人识别号|密码区|开票日期|发票号码|机器编号|校验码|收款人|复核人|开票人|购买方信息|销售方信息|购买方|销售方|项目名称|规格型号|单位|数量|单价|金额|税率|税额|名称|名\\s*称)/g, ''); // 移除错位的表头
        cleaned = cleaned.replace(/^\\d*(?:年|[-/.])?\\d{1,2}(?:月|[-/.])\\d{1,2}日?/, ''); // 移除被数字挤压导致年份丢失的残余日期（如“年6月5日”）
        cleaned = cleaned.replace(/^(?=[0-9A-Z]*[0-9])[0-9A-Z]{15,20}/i, ''); // 移除开头的税号
        cleaned = cleaned.replace(/^\\d{6,}/, ''); // 移除开头的连续数字(发票号码等)
      }
      return cleaned;
    };
    
    const isValidName = (name: string) => name.length >= 2 && !name.startsWith('项目');
    
    const hasCompanyKeyword = (name: string) => {
      const upper = name.toUpperCase();
      return companyKeywords.some(k => name.includes(k)) || enKeywords.some(k => upper.includes(k));
    };

    const extractName = (prefix: string) => {
      // 策略1: 匹配区域前缀 (购买方/销售方)
      const areaPattern = new RegExp(`${prefix}[^名]{0,20}名称[：:]([${nameChars}]{4,60})`);
      const areaMatch = cleanText.match(areaPattern);
      if (areaMatch) {
        const cleaned = cleanCompanyName(areaMatch[1]);
        if (isValidName(cleaned)) return cleaned;
      }
      return null;
    };

    let buyer = extractName('购买方') || extractName('购');
    let seller = extractName('销售方') || extractName('销');

    if (!buyer || !seller) {
      // 策略2: 提取名称并校验关键词
      const namePattern = new RegExp(`名称[：:]([${nameChars}]{4,60})`, 'g');
      const rawNameMatches = [...cleanText.matchAll(namePattern)].map(m => m[1]);
      const validNames = rawNameMatches.map(cleanCompanyName).filter(name => isValidName(name) && hasCompanyKeyword(name));
      
      if (validNames.length >= 2) {
        if (!buyer) buyer = validNames[0];
        if (!seller) seller = validNames[1];
      } else {
        // 策略3: 暴力兜底，匹配包含公司后缀的中英文字符串
        const cnPattern = new RegExp(`([${nameChars}]{2,40}(?:公司|企业|股份|有限|集团|厂|店|中心|工作室|合作社|委员会|局|院|所))`, 'g');
        const enPattern = new RegExp(`([${nameChars}]{4,40}(?:INC|CORP|LTD|LLC|COMPANY|LIMITED|CORPORATION))`, 'gi');
        
        const companies = [
          ...[...cleanText.matchAll(cnPattern)].map(m => m[1]),
          ...[...cleanText.matchAll(enPattern)].map(m => m[1])
        ];
        
        const uniqueCompanies = Array.from(new Set(companies.map(cleanCompanyName).filter(isValidName)));
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
