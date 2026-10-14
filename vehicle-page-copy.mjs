const messages={
 snapshot:['Saved listing from {date}. Price and availability require current confirmation with E2.','Maklumat disimpan pada {date}. Sahkan harga dan ketersediaan semasa dengan E2.','资料快照：{date}。价格与库存须向 E2 确认。'],
 verified:['Price and availability checked just now.','Harga dan ketersediaan baru disemak.','已核对当前价格与库存。'],
 offline:['Current stock could not be checked. These are saved listing details; confirm with E2 before relying on price or availability.','Stok semasa tidak dapat disemak. Ini maklumat tersimpan; sahkan harga dan ketersediaan dengan E2.','暂时无法核对当前库存。以下为已保存资料，请向 E2 确认价格与库存。'],
 photosLoading:['Loading photos. Vehicle details are ready.','Memuatkan foto. Maklumat kereta sudah tersedia.','照片加载中，车辆资料已可查看。'],
 photosUnavailable:['Photos are temporarily unavailable. Retry photos; vehicle details remain available.','Foto tidak tersedia buat sementara. Cuba semula; maklumat kereta masih tersedia.','照片暂时无法载入，可重试；车辆资料仍可查看。'],
 noJS:['Vehicle details and the available main photo remain readable without JavaScript. Live inventory checks, salesperson selection, the photo album and calculator need JavaScript. The enquiry link contacts the E2 team.','Maklumat kereta dan foto utama yang tersedia boleh dilihat tanpa JavaScript. Semakan stok semasa, pilihan jurujual, album foto dan kalkulator memerlukan JavaScript. Pautan pertanyaan menghubungi pasukan E2.','未开启 JavaScript 仍可阅读车辆资料及可用主图。即时库存核对、销售人员匹配、相册及计算器需要 JavaScript；咨询链接联系 E2 团队。']
};
export function vehicleCopy(key,lang='en',values={}){return messages[key][{en:0,ms:1,zh:2}[lang]??0].replace(/\{(\w+)\}/g,(m,k)=>values[k]??m);}
