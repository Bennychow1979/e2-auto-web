// Translate only exact, reviewed inventory copy. An edited description falls back to its new source.
const descriptions=[
  {
    "source": "ORIGINAL FULL SERVICE RECORD !",
    "ms": "REKOD SERVIS ASAL LENGKAP!",
    "zh": "完整原始保养记录！"
  },
  {
    "source": "FULL SERVICE RECORD",
    "ms": "REKOD SERVIS LENGKAP",
    "zh": "完整保养记录"
  },
  {
    "source": "Honda Insight 1.3 Hybrid\nBajet paling rendah dalam showroom kami. Minyak paling jimat.\nUntuk yang nak kereta pergi balik kerja, hantar anak, pergi pasar — tak nak bulanan tinggi, tak nak isi minyak selalu. Insight Hybrid buat kerja tu.",
    "en": "Honda Insight 1.3 Hybrid\nThe lowest-budget option in our showroom, with excellent fuel economy.\nFor commuting, school runs and everyday errands — without high monthly payments or frequent fuel stops. The Insight Hybrid is ready for everyday life.",
    "zh": "Honda Insight 1.3 Hybrid\n展厅内预算最低的选择，省油实用。\n上下班、接送孩子、买菜代步，不想承担太高的月供，也不想频繁加油，Insight Hybrid 满足日常需要。"
  },
  {
    "source": "FULL SERVICE , UNDER WARRANTY",
    "ms": "SERVIS LENGKAP, MASIH DALAM WARANTI",
    "zh": "完整保养，仍在保修期内"
  },
  {
    "source": "Civic FB 2.0 — enjin 2.0 padu, kabin luas, dan rupa yang tak pernah lapuk. Kereta yang bila awak sampai, orang tahu awak dah sampai.\n2015 Honda Civic FB 2.0\nAuto · Batu Caves\n✅ Tahun MFG verified — kami tunjuk geran\n✅ Bukan kereta banjir\n✅ Bukan kereta accident major\n✅ Bukan kereta lelong\nCara bayar:\n🔑 Full loan — boleh\n🔑 Kalau tak cukup, ada cash back\n🔑 Kes CTOS, CCRIS, AKPK, PTPTN, dokumen tak lengkap — kami nilai satu-satu\n🔑 Keputusan 3-5 hari bekerja\nBonus booking:\n🎁 Free service & polish\n🎁 Free tinted voucher RM500\n🎁 Extended warranty 1-3 tahun",
    "en": "Civic FB 2.0 — a capable 2.0 engine, a spacious cabin and a timeless look. A car that makes an entrance.\n2015 Honda Civic FB 2.0\nAutomatic · Batu Caves\n✅ Manufacturing year verified — registration document available\n✅ Not flood damaged\n✅ No major accident\n✅ Not an auction car\nPayment options:\n🔑 Full loan available for consideration\n🔑 Cashback options available\n🔑 CTOS, CCRIS, AKPK, PTPTN or incomplete documents — assessed individually\n🔑 Decision in 3–5 working days\nBooking bonuses:\n🎁 Free service and polish\n🎁 Free RM500 tint voucher\n🎁 Extended warranty of 1–3 years",
    "zh": "Civic FB 2.0 — 2.0 动力、宽敞车厢，耐看的经典外形。\n2015 Honda Civic FB 2.0\n自动挡 · Batu Caves\n✅ 出厂年份已核实，可查看车辆登记文件\n✅ 非泡水车\n✅ 无重大事故\n✅ 非拍卖车\n付款方案：\n🔑 可考虑全额贷款\n🔑 有现金回扣方案\n🔑 CTOS、CCRIS、AKPK、PTPTN 或文件不齐，按个别情况评估\n🔑 3–5 个工作日出结果\n预订优惠：\n🎁 免费保养与抛光\n🎁 免费 RM500 隔热膜礼券\n🎁 1–3 年延长保修"
  },
  {
    "source": "Toyota Camry 2.5 Hybrid Luxury\nKeselesaan Camry. Minyak macam kereta kecil. Harga macam kereta nasional.\nHybrid — masuk minyak kurang, jalan lebih jauh. Kabin senyap, tempat duduk kulit, ruang belakang luas. Kereta yang buat awak nampak macam boss, tapi bulanan tak menyeksa.",
    "en": "Toyota Camry 2.5 Hybrid Luxury\nCamry comfort, small-car fuel economy and a price comparable to a national-brand car.\nHybrid efficiency means fewer fuel stops and more distance. Enjoy a quiet cabin, leather seats and a spacious rear seat — executive style with manageable monthly payments.",
    "zh": "Toyota Camry 2.5 Hybrid Luxury\nCamry 的舒适，小车般的油耗，国产车般的价格。\n混合动力让你少加油、走更远。安静车厢、皮革座椅、宽敞后排，兼顾气派与每月预算。"
  },
  {
    "source": "2017 Honda CR-V 1.5 TC-P\nBukan semua orang perlu kereta besar. Ramai cuma nak satu kereta family yang selesa, jimat minyak, dan tak menyusahkan.\nCR-V 1.5 Turbo TC-P — masih antara SUV paling ramai cari di pasaran second hand.",
    "en": "2017 Honda CR-V 1.5 TC-P\nNot everyone needs a large car. Many families simply want a comfortable, fuel-efficient car that makes everyday life easier.\nThe CR-V 1.5 Turbo TC-P remains a popular choice in the used SUV market.",
    "zh": "2017 Honda CR-V 1.5 TC-P\n家用选车，很多人看重的是舒适、省油和日常使用方便。\nCR-V 1.5 Turbo TC-P 是二手 SUV 市场中的热门选择。"
  },
  {
    "source": "Dah siap modified. Tak payah keluar duit lagi.\nVios J Thailook — stance rendah, rim custom, bodykit siap pasang. Untuk yang dah lama nak Vios style Thai tapi malas nak buat sendiri. Ambil, terus jalan.\n2016 Toyota Vios 1.5 J (Thailook)",
    "en": "Already modified and ready to enjoy.\nVios J Thailook — lowered stance, custom wheels and a fitted body kit. For anyone who wants Thai-inspired Vios styling without doing the work themselves.\n2016 Toyota Vios 1.5 J (Thailook)",
    "zh": "改装已完成，入手即可享受。\nVios J Thailook — 低趴姿态、定制轮圈与已安装的车身套件。适合喜欢泰式 Vios 风格，又不想自己动手改装的你。\n2016 Toyota Vios 1.5 J（Thailook）"
  },
  {
    "source": "Hyundai Grand Starex Executive Plus 2.5 (2021) Left Power Door\n11 tempat duduk. Diesel. Tahun 2021.\nUntuk keluarga besar yang setiap kali balik kampung kena bawa dua kereta. Untuk yang buat bisnes — homestay, tour, hantar pekerja, hantar budak sekolah.\nSatu kereta, semua orang muat, minyak diesel jimat untuk jalan jauh.",
    "en": "Hyundai Grand Starex Executive Plus 2.5 (2021) — left power sliding door\n11 seats. Diesel. Year 2021.\nFor large families who usually need two cars for a trip home, or businesses handling homestay guests, tours, employee transport or school runs.\nRoom for everyone in one vehicle, with diesel efficiency for longer trips.",
    "zh": "Hyundai Grand Starex Executive Plus 2.5（2021）— 左侧电动滑门\n11 座，柴油，2021 年。\n适合回乡时常需开两辆车的大家庭，也适用于民宿、旅游、员工或学生接送等用途。\n一辆车容纳更多乘客，柴油动力适合长途出行。"
  },
  {
    "source": "## Power Meets Refinement\n\nExperience the perfect balance of performance, comfort and style with the 2019 Mazda CX-5 2.5 SKYACTIV-G High TC.\n\nIts powerful turbocharged engine delivers confident acceleration, while the refined and spacious cabin keeps every journey comfortable. With its elegant design and practical SUV versatility, this CX-5 is ideal for daily driving, family trips and long-distance travel.\n\n### Why You’ll Love It\n\n* Powerful and responsive performance\n* Premium, comfortable cabin\n* Sporty and elegant design\n* Spacious and practical for everyday use\n* Smooth automatic transmission\n* Trade-in available\n* Loan application assistance available\n\n## See It for Yourself\n\nVisit E2 Auto to view the actual vehicle and experience it in person. Contact our team today to arrange a viewing or test drive.\n\n*Please confirm the vehicle’s condition, specifications, price and availability with E2 Auto before purchase.*",
    "ms": "Kuasa dan keselesaan dalam satu SUV\n\nNikmati gabungan prestasi, keselesaan dan gaya dengan Mazda CX-5 2.5 SKYACTIV-G High TC tahun 2019.\n\nEnjin turbo menawarkan pecutan yang meyakinkan, manakala kabin luas dan kemas memberikan keselesaan sepanjang perjalanan. Reka bentuk elegan dan kepraktisan SUV sesuai untuk kegunaan harian, keluarga dan perjalanan jauh.\n\nAntara tarikannya\n• Prestasi bertenaga dan responsif\n• Kabin premium yang selesa\n• Reka bentuk sporty dan elegan\n• Ruang praktikal untuk kegunaan harian\n• Transmisi automatik yang lancar\n• Tukar beli tersedia\n• Bantuan permohonan pinjaman tersedia\n\nLihat sendiri di E2 Auto\nDatang melihat kereta sebenar. Hubungi pasukan kami untuk mengatur lawatan atau pandu uji.\n\nSila sahkan keadaan, spesifikasi, harga dan ketersediaan kereta dengan E2 Auto sebelum membeli.",
    "zh": "动力与质感兼备\n\n2019 Mazda CX-5 2.5 SKYACTIV-G High TC，兼顾性能、舒适与外形。\n\n涡轮增压动力带来从容加速，精致宽敞的车厢让每一段旅程更舒适。优雅设计与 SUV 的实用空间，适合日常驾驶、家庭出游和长途旅程。\n\n车辆亮点\n• 动力充足，反应灵敏\n• 舒适且有质感的车厢\n• 运动与优雅兼备的设计\n• 宽敞实用，适合日常使用\n• 顺畅的自动变速箱\n• 可咨询旧车置换\n• 可协助贷款申请\n\n欢迎亲自到店体验\n到访 E2 Auto 查看实车，联系我们安排看车或试驾。\n\n购买前请向 E2 Auto 确认车况、规格、价格与库存。"
  }
];
export function descriptionFor(source,lang){const entry=descriptions.find(item=>item.source===source);return entry?.[lang]??source;}
