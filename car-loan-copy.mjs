export const carLoanPath = lang => '/' + (lang === 'en' ? '' : lang + '/') + 'car-loan-calculator/';
export const carLoanCopy = {
 en: {
  title:'Car Loan Calculator Malaysia | E2 Auto', description:'Estimate car loan monthly payments, total interest and repayment from your car price, down payment, flat interest rate and loan term.',
  heading:'Car loan calculator', kicker:'PLAN YOUR NEXT CAR', lead:'Start with the car price. Adjust your down payment, flat interest rate and loan term to estimate your monthly payment.',
  price:'Car price (RM)', deposit:'Down payment (RM)', rate:'Annual flat interest rate (%)', years:'Loan term (years)', rateHelp:'Use the flat rate quoted by your lender, not an effective interest rate (EIR).', example:'The starting values are an illustration, not an E2 or bank offer.',
  calculate:'Calculate monthly payment', reset:'Reset example', result:'Your estimate', monthly:'Estimated monthly payment', perMonth:'/ month', principal:'Loan amount', interest:'Total interest', repayment:'Total loan repayment', total:'Total including down payment', months:'monthly payments',
  note:'Flat-rate estimate only. Excludes insurance, road tax and other fees. Actual rate, financing amount, term and approval depend on the lender, vehicle and applicant. Rounding may affect the final instalment.',
  error:'Check your figures: price RM0.01–10,000,000; down payment from RM0 to the car price; annual flat rate 0–30%; term 1–9 whole years.',
  invalid:'Enter valid figures to see your estimate.', skip:'Skip to car loan calculator', browse:'Browse available cars', financing:'Ask about financing', roadtax:'Road tax calculator',
  how:'How this estimate works', formula:'Loan amount = car price − down payment. Total interest = loan amount × annual flat rate ÷ 100 × years. Monthly payment = (loan amount + total interest) ÷ number of months.',
  faq:'Before you apply', questions:[
   ['Is a flat rate the same as EIR?','No. Flat-rate interest uses the original loan amount throughout the term. Reducing-balance financing charges interest on the remaining balance; EIR is not interchangeable with a flat rate. If your quote uses reducing balance or EIR, ask the lender for its repayment schedule.'],
   ['Can I choose any down payment or loan term?','The controls let you explore a budget. They do not confirm eligibility, zero-down-payment financing or a nine-year term. Available terms depend on lender approval and the age and condition of the car.'],
   ['Does the estimate include all ownership costs?','No. Add insurance, road tax, fees, maintenance and running costs to your budget. This is not an early-settlement calculation. Contact E2 to discuss the vehicle and your financing options.']
  ]
 },
 ms: {
  title:'Kalkulator Pinjaman Kereta | E2 Auto', description:'Anggarkan ansuran bulanan, jumlah faedah dan bayaran balik berdasarkan harga kereta, deposit, kadar faedah rata dan tempoh pinjaman.',
  heading:'Kalkulator pinjaman kereta', kicker:'RANCANG KERETA SETERUSNYA', lead:'Masukkan harga kereta. Laraskan deposit, kadar faedah rata dan tempoh pinjaman untuk menganggarkan ansuran bulanan.',
  price:'Harga kereta (RM)', deposit:'Deposit (RM)', rate:'Kadar faedah rata tahunan (%)', years:'Tempoh pinjaman (tahun)', rateHelp:'Gunakan kadar rata yang diberi pemberi pinjaman, bukan kadar faedah efektif (EIR).', example:'Nilai awal ialah contoh sahaja, bukan tawaran E2 atau bank.',
  calculate:'Kira ansuran bulanan', reset:'Tetapkan semula contoh', result:'Anggaran anda', monthly:'Anggaran ansuran bulanan', perMonth:'/ bulan', principal:'Jumlah pinjaman', interest:'Jumlah faedah', repayment:'Jumlah bayaran balik pinjaman', total:'Jumlah termasuk deposit', months:'bayaran bulanan',
  note:'Anggaran kadar rata sahaja. Tidak termasuk insurans, cukai jalan dan fi lain. Kadar, jumlah pembiayaan, tempoh dan kelulusan sebenar bergantung pada pemberi pinjaman, kenderaan dan pemohon. Pembundaran boleh menjejaskan ansuran terakhir.',
  error:'Semak angka: harga RM0.01–10,000,000; deposit dari RM0 hingga harga kereta; kadar rata tahunan 0–30%; tempoh 1–9 tahun penuh.',
  invalid:'Masukkan angka yang sah untuk melihat anggaran.', skip:'Langkau ke kalkulator pinjaman kereta', browse:'Lihat kereta tersedia', financing:'Tanya tentang pembiayaan', roadtax:'Kalkulator cukai jalan',
  how:'Cara anggaran ini dikira', formula:'Jumlah pinjaman = harga kereta − deposit. Jumlah faedah = jumlah pinjaman × kadar rata tahunan ÷ 100 × tahun. Ansuran bulanan = (jumlah pinjaman + jumlah faedah) ÷ bilangan bulan.',
  faq:'Sebelum memohon', questions:[
   ['Adakah kadar rata sama dengan EIR?','Tidak. Faedah kadar rata menggunakan jumlah pinjaman asal sepanjang tempoh. Pembiayaan baki berkurangan mengenakan faedah atas baki yang belum dibayar; EIR tidak boleh digunakan sebagai kadar rata. Jika sebut harga menggunakan baki berkurangan atau EIR, minta jadual bayaran balik daripada pemberi pinjaman.'],
   ['Bolehkah saya memilih apa-apa deposit atau tempoh?','Kawalan ini membantu anda merancang bajet. Ia bukan pengesahan kelayakan, pembiayaan tanpa deposit atau tempoh sembilan tahun. Tempoh yang tersedia tertakluk pada kelulusan pemberi pinjaman serta umur dan keadaan kereta.'],
   ['Adakah semua kos pemilikan termasuk?','Tidak. Tambahkan insurans, cukai jalan, fi, penyelenggaraan dan kos penggunaan dalam bajet anda. Ini bukan pengiraan penyelesaian awal. Hubungi E2 untuk berbincang tentang kereta dan pilihan pembiayaan.']
  ]
 },
 zh: {
  title:'汽车贷款计算器｜月供估算 | E2 Auto', description:'输入车价、首付、年平息利率和贷款年限，估算汽车贷款月供、总利息与总还款额。E2 Auto 马来西亚汽车贷款计算器。',
  heading:'汽车贷款计算器', kicker:'规划下一辆心仪车', lead:'输入车价，调整首付、年平息利率和贷款年限，估算适合预算的每月供款。',
  price:'车价（RM）', deposit:'首付（RM）', rate:'年平息利率（%）', years:'贷款年限（年）', rateHelp:'请填写贷款机构提供的平息利率，不是实际年利率（EIR）。', example:'初始数值仅作示例，不代表 E2 或银行报价。',
  calculate:'计算每月供款', reset:'重设示例', result:'你的估算', monthly:'预计每月供款', perMonth:'/ 月', principal:'贷款本金', interest:'总利息', repayment:'贷款总还款额', total:'含首付的总支出', months:'期月供',
  note:'仅作平息贷款估算，不含保险、路税及其他费用。实际利率、贷款金额、年限与审批取决于贷款机构、车辆及申请人。四舍五入可能影响最后一期供款。',
  error:'请检查：车价 RM0.01–10,000,000；首付介于 RM0 与车价之间；年平息利率 0–30%；贷款年限为 1–9 整年。',
  invalid:'请输入有效数值以查看估算。', skip:'跳至汽车贷款计算器', browse:'查看现有车辆', financing:'咨询汽车贷款', roadtax:'路税计算器',
  how:'估算如何计算', formula:'贷款本金 = 车价 − 首付。总利息 = 贷款本金 × 年平息利率 ÷ 100 × 年限。每月供款 =（贷款本金 + 总利息）÷ 总月数。',
  faq:'申请前须知', questions:[
   ['平息利率和 EIR 一样吗？','不一样。平息按原始贷款本金计算整个贷款期的利息；递减余额贷款按剩余本金计息，EIR 不能直接当作平息输入。如果银行报价采用递减余额或 EIR，请向银行索取还款表。'],
   ['首付和年限可以任意选择吗？','这里的输入用于规划预算，不代表已符合贷款资格，也不承诺零首付或九年贷款。可批的年限取决于贷款机构审批、车龄及车辆状况。'],
   ['结果包含所有养车费用吗？','不包含。预算还需加入保险、路税、其他费用、保养及日常使用成本。本工具也不计算提前结清金额。欢迎联系 E2 了解车辆和贷款选项。']
  ]
 }
};
