/**
 * Comprehensive Vietnamese Province and City Extractor
 * Identifies legacy aliases and normalizes them to Vietnam's current 34
 * province-level administrative units (effective from 2025).
 */

// Helper to remove accents for unaccented matching
function removeAccents(str = '') {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd');
}

function cleanForMatching(text = '') {
  if (!text || typeof text !== 'string') return '';
  return text.toLowerCase()
    .replace(/[,\.\-\/\(\):;!?\n\r\t#@"'`~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const PROVINCES_MAP = [
  // 1. TP. Hồ Chí Minh
  {
    name: 'TP. Hồ Chí Minh',
    keywords: [
      'hồ chí minh', 'ho chi minh', 'tp hcm', 'tphcm', 'tp.hcm', 'tp. hcm', 'sài gòn', 'sai gon', 'saigon',
      'thủ đức', 'thu duc', 'tp thủ đức', 'tp. thủ đức',
      'quận 1', 'quan 1', 'q 1', 'q.1', 'q1',
      'quận 2', 'quan 2', 'q 2', 'q.2', 'q2',
      'quận 3', 'quan 3', 'q 3', 'q.3', 'q3',
      'quận 4', 'quan 4', 'q 4', 'q.4', 'q4',
      'quận 5', 'quan 5', 'q 5', 'q.5', 'q5',
      'quận 6', 'quan 6', 'q 6', 'q.6', 'q6',
      'quận 7', 'quan 7', 'q 7', 'q.7', 'q7',
      'quận 8', 'quan 8', 'q 8', 'q.8', 'q8',
      'quận 9', 'quan 9', 'q 9', 'q.9', 'q9',
      'quận 10', 'quan 10', 'q 10', 'q.10', 'q10',
      'quận 11', 'quan 11', 'q 11', 'q.11', 'q11',
      'quận 12', 'quan 12', 'q 12', 'q.12', 'q12',
      'bình thạnh', 'binh thanh', 'gò vấp', 'go vap', 'tân bình', 'tan binh',
      'tân phú', 'tan phu', 'phú nhuận', 'phu nhuan', 'bình tân', 'binh tan',
      'hóc môn', 'hoc mon', 'củ chi', 'cu chi', 'nhà bè', 'nha be',
      'bình chánh', 'binh chanh', 'cần giờ', 'can gio'
    ]
  },
  // 2. Hà Nội
  {
    name: 'Hà Nội',
    keywords: [
      'hà nội', 'ha noi', 'hanoi', 'thủ đô', 'thu do', 'tp hà nội', 'tp. hà nội',
      'hoàn kiếm', 'hoan kiem', 'ba đình', 'ba dinh', 'đống đa', 'dong da',
      'hai bà trưng', 'hai ba trung', 'hoàng mai', 'hoang mai', 'thanh xuân', 'thanh xuan',
      'long biên', 'long bien', 'nam từ liêm', 'nam tu liem', 'bắc từ liêm', 'bac tu liem',
      'tây hồ', 'tay ho', 'cầu giấy', 'cau giay', 'hà đông', 'ha dong',
      'sơn tây', 'son tay', 'ba vì', 'ba vi', 'chương mỹ', 'chuong my',
      'đan phượng', 'dan phuong', 'đông anh', 'dong anh', 'gia lâm', 'gia lam',
      'hoài đức', 'hoai duc', 'mê linh', 'me linh', 'mỹ đức', 'my duc',
      'phú xuyên', 'phu xuyen', 'phúc thọ', 'phuc tho', 'quốc oai', 'quoc oai',
      'sóc sơn', 'soc son', 'thạch thất', 'thach that', 'thanh oai', 'thanh oai',
      'thanh trì', 'thanh tri', 'thường tín', 'thuong tin', 'ứng hòa', 'ung hoa'
    ]
  },
  // 3. Đà Nẵng
  {
    name: 'Đà Nẵng',
    keywords: [
      'đà nẵng', 'da nang', 'danang', 'tp đà nẵng', 'tp. đà nẵng',
      'hải châu', 'hai chau', 'thanh khê', 'thanh khe', 'sơn trà', 'son tra',
      'ngũ hành sơn', 'ngu hanh son', 'liên chiểu', 'lien chieu', 'cẩm lệ', 'cam le', 'hòa vang', 'hoa vang'
    ]
  },
  // 4. Hải Phòng
  {
    name: 'Hải Phòng',
    keywords: [
      'hải phòng', 'hai phong', 'haiphong', 'tp hải phòng', 'tp. hải phòng',
      'ngô quyền', 'ngo quyen', 'hồng bàng', 'hong bang', 'lê chân', 'le chan',
      'hải an', 'hai an', 'kiến an', 'kien an', 'đồ sơn', 'do son',
      'dương kinh', 'duong kinh', 'thủy nguyên', 'thuy nguyen', 'an dương', 'an duong',
      'an lão', 'an lao', 'kiến thụy', 'kien thuy', 'tiên lãng', 'tien lang', 'vĩnh bảo', 'vinh bao', 'cát bà', 'cat ba'
    ]
  },
  // 5. Cần Thơ
  {
    name: 'Cần Thơ',
    keywords: [
      'cần thơ', 'can tho', 'cantho', 'tp cần thơ', 'tp. cần thơ',
      'ninh kiều', 'ninh kieu', 'bình thủy', 'binh thuy', 'cái răng', 'cai rang',
      'ô môn', 'o mon', 'thốt nốt', 'thot not', 'phong điền', 'phong dien', 'cờ đỏ', 'co do', 'thới lai', 'thoi lai'
    ]
  },
  // 6. Bình Dương
  {
    name: 'Bình Dương',
    keywords: [
      'bình dương', 'binh duong', 'binhduong', 'tỉnh bình dương',
      'thủ dầu một', 'thu dau mot', 'tdm', 'dĩ an', 'di an', 'thuận an', 'thuan an',
      'bến cát', 'ben cat', 'tân uyên', 'tan uyen', 'bàu bàng', 'bau bang',
      'dầu tiếng', 'dau tieng', 'phú giáo', 'phu giao', 'bắc tân uyên'
    ]
  },
  // 7. Đồng Nai
  {
    name: 'Đồng Nai',
    keywords: [
      'đồng nai', 'dong nai', 'dongnai', 'tỉnh đồng nai',
      'biên hòa', 'bien hoa', 'long khánh', 'long khanh', 'long thành', 'long thanh',
      'nhơn trạch', 'nhon trach', 'trảng bom', 'trang bom', 'vĩnh cửu', 'vinh cuu',
      'định quán', 'dinh quan', 'thống nhất', 'thong nhat', 'cẩm mỹ', 'cam my', 'xuân lộc', 'xuan loc'
    ]
  },
  // 8. Bà Rịa - Vũng Tàu
  {
    name: 'Bà Rịa - Vũng Tàu',
    keywords: [
      'bà rịa - vũng tàu', 'bà rịa vũng tàu', 'ba ria vung tau', 'vũng tàu', 'vung tau', 'vungtau',
      'bà rịa', 'ba ria', 'phú mỹ', 'phu my', 'châu đức', 'chau duc',
      'xuyên mộc', 'xuyen moc', 'long điền', 'long dien', 'đất đỏ', 'dat do', 'côn đảo', 'con dao'
    ]
  },
  // 9. Khánh Hòa
  {
    name: 'Khánh Hòa',
    keywords: [
      'khánh hòa', 'khanh hoa', 'khanhhoa', 'nha trang', 'nhatrang',
      'cam ranh', 'camranh', 'ninh hòa', 'ninh hoa', 'vạn ninh', 'van ninh',
      'diên khánh', 'dien khanh', 'cam lâm', 'cam lam', 'khánh vĩnh', 'khánh sơn'
    ]
  },
  // 10. Lâm Đồng
  {
    name: 'Lâm Đồng',
    keywords: [
      'lâm đồng', 'lam dong', 'lamdong', 'đà lạt', 'da lat', 'dalat',
      'bảo lộc', 'bao loc', 'đức trọng', 'duc trong', 'đơn dương', 'don duong',
      'lạc dương', 'lac duong', 'lâm hà', 'lam ha', 'bảo lâm', 'bao lam', 'di linh', 'đạ huoai', 'đạ tẻh', 'cát tiên'
    ]
  },
  // 11. Quảng Ninh
  {
    name: 'Quảng Ninh',
    keywords: [
      'quảng ninh', 'quang ninh', 'quangninh', 'hạ long', 'ha long', 'halong',
      'cẩm phả', 'cam pha', 'uông bí', 'uong bi', 'móng cái', 'mong cai',
      'đông triều', 'dong trieu', 'quảng yên', 'quang yen', 'vân đồn', 'van don', 'tiên yên', 'ba chẽ', 'cô tô'
    ]
  },
  // 12. Bắc Ninh
  {
    name: 'Bắc Ninh',
    keywords: [
      'bắc ninh', 'bac ninh', 'bacninh', 'từ sơn', 'tu son', 'yên phong', 'yen phong',
      'quế võ', 'que vo', 'tiên du', 'tien du', 'thuận thành', 'thuan thanh', 'gia bình', 'lương tài'
    ]
  },
  // 13. Bắc Giang
  {
    name: 'Bắc Giang',
    keywords: [
      'bắc giang', 'bac giang', 'bacgiang', 'việt yên', 'viet yen', 'hiệp hòa', 'hiep hoa',
      'lạng giang', 'lang giang', 'lục nam', 'luc nam', 'lục ngạn', 'luc ngan', 'tân yên', 'yên dũng', 'yên thế', 'sơn động'
    ]
  },
  // 14. Hải Dương
  {
    name: 'Hải Dương',
    keywords: [
      'hải dương', 'hai duong', 'haiduong', 'chí linh', 'chi linh', 'kinh môn', 'kinh mon',
      'bình giang', 'binh giang', 'cẩm giàng', 'cam giang', 'nam sách', 'nam sach',
      'kim thành', 'thanh hà', 'thanh miện', 'gia lộc', 'tứ kỳ', 'ninh giang'
    ]
  },
  // 15. Hưng Yên
  {
    name: 'Hưng Yên',
    keywords: [
      'hưng yên', 'hung yen', 'hungyen', 'mỹ hào', 'my hao', 'văn giang', 'van giang',
      'yên mỹ', 'yen my', 'khoái châu', 'khoai chau', 'văn lâm', 'van lam',
      'kim động', 'tiên lữ', 'phù cừ', 'ân thi'
    ]
  },
  // 16. Thái Nguyên
  {
    name: 'Thái Nguyên',
    keywords: [
      'thái nguyên', 'thai nguyen', 'thainguyen', 'sông công', 'song cong',
      'phổ yên', 'pho yen', 'đại từ', 'dai tu', 'định hóa', 'đồng hỷ', 'phú bình', 'phú lương', 'võ nhai'
    ]
  },
  // 17. Nam Định
  {
    name: 'Nam Định',
    keywords: [
      'nam định', 'nam dinh', 'namdinh', 'hải hậu', 'hai hau', 'giao thủy', 'giao thuy',
      'nghĩa hưng', 'nghia hung', 'xuân trường', 'xuan truong', 'trực ninh', 'vụ bản', 'ý yên', 'mỹ lộc', 'nam trực'
    ]
  },
  // 18. Thái Bình
  {
    name: 'Thái Bình',
    keywords: [
      'thái bình', 'thai binh', 'thaibinh', 'tiền hải', 'tien hai', 'thái thụy', 'thai thuy',
      'hưng hà', 'hung ha', 'quỳnh phụ', 'quynh phu', 'đông hưng', 'kiến xương', 'vũ thư'
    ]
  },
  // 19. Ninh Bình
  {
    name: 'Ninh Bình',
    keywords: [
      'ninh bình', 'ninh binh', 'ninhbinh', 'tam điệp', 'tam diep', 'hoa lư', 'hoa lu',
      'gia viễn', 'gia vien', 'kim sơn', 'kim son', 'nho quan', 'nho quan', 'yên khánh', 'yên mô'
    ]
  },
  // 20. Hà Nam
  {
    name: 'Hà Nam',
    keywords: [
      'hà nam', 'ha nam', 'hanam', 'phủ lý', 'phu ly', 'duy tiên', 'duy tien',
      'kim bảng', 'kim bang', 'lý nhân', 'ly nhan', 'thanh liêm', 'thanh liem', 'bình lục'
    ]
  },
  // 21. Vĩnh Phúc
  {
    name: 'Vĩnh Phúc',
    keywords: [
      'vĩnh phúc', 'vinh phuc', 'vinhphuc', 'vĩnh yên', 'vinh yen', 'phúc yên', 'phuc yen',
      'bình xuyên', 'binh xuyen', 'tam đảo', 'tam dao', 'vĩnh tường', 'yên lạc', 'lập thạch', 'sông lô', 'tam dương'
    ]
  },
  // 22. Phú Thọ
  {
    name: 'Phú Thọ',
    keywords: [
      'phú thọ', 'phu tho', 'phutho', 'việt trì', 'viet tri', 'thị xã phú thọ',
      'lâm thao', 'lam thao', 'phù ninh', 'phu ninh', 'thanh ba', 'thanh sơn', 'thanh thủy', 'hạ hòa', 'đoan hùng', 'cẩm khê'
    ]
  },
  // 23. Thanh Hóa
  {
    name: 'Thanh Hóa',
    keywords: [
      'thanh hóa', 'thanh hoa', 'thanhhoa', 'sầm sơn', 'sam son', 'bỉm sơn', 'bim son',
      'nghi sơn', 'nghi son', 'hoằng hóa', 'hoang hoa', 'quảng xương', 'quang xuong', 'thọ xuân', 'tho xuan',
      'tĩnh gia', 'hà trung', 'hậu lộc', 'nga sơn', 'nông cống', 'triệu sơn', 'yên định'
    ]
  },
  // 24. Nghệ An
  {
    name: 'Nghệ An',
    keywords: [
      'nghệ an', 'nghe an', 'nghean', 'tp vinh', 'thành phố vinh', 'cửa lò', 'cua lo',
      'hoàng mai', 'hoang mai', 'thái hòa', 'thai hoa', 'diễn châu', 'dien chau',
      'quỳnh lưu', 'quynh luu', 'đô lương', 'do luong', 'nghi lộc', 'nghi loc', 'hưng nguyên', 'nam đàn', 'nghĩa đàn'
    ]
  },
  // 25. Hà Tĩnh
  {
    name: 'Hà Tĩnh',
    keywords: [
      'hà tĩnh', 'ha tinh', 'hatinh', 'hồng lĩnh', 'hong linh', 'kỳ anh', 'ky anh',
      'cẩm xuyên', 'cam xuyen', 'thạch hà', 'thach ha', 'can lộc', 'đức thọ', 'nghi xuân', 'hương sơn', 'hương khê'
    ]
  },
  // 26. Quảng Bình
  {
    name: 'Quảng Bình',
    keywords: [
      'quảng bình', 'quang binh', 'quangbinh', 'đồng hới', 'dong hoi', 'donghoi',
      'ba đồn', 'ba don', 'bố trạch', 'bo trach', 'lệ thủy', 'le thuy',
      'phong nha', 'phongnha', 'quảng trạch', 'quảng ninh quảng bình', 'tuyên hóa', 'minh hóa'
    ]
  },
  // 27. Quảng Trị
  {
    name: 'Quảng Trị',
    keywords: [
      'quảng trị', 'quang tri', 'quangtri', 'đông hà', 'dong ha', 'thị xã quảng trị',
      'gio linh', 'gio linh', 'vĩnh linh', 'vinh linh', 'triệu phong', 'hải lăng', 'cam lộ', 'đakrông', 'hướng hóa'
    ]
  },
  // 28. Thừa Thiên Huế
  {
    name: 'Thừa Thiên Huế',
    keywords: [
      'thừa thiên huế', 'thừa thiên - huế', 'thừa thiên', 'thua thien hue', 'thua thien',
      'huế', 'hue', 'tp huế', 'tp. huế', 'thành phố huế', 'cố đô huế',
      'hương thủy', 'huong thuy', 'hương trà', 'huong tra', 'phú vang', 'phú lộc', 'quảng điền', 'a lưới', 'nam đông'
    ]
  },
  // 29. Quảng Nam
  {
    name: 'Quảng Nam',
    keywords: [
      'quảng nam', 'quang nam', 'quangnam', 'tam kỳ', 'tam ky', 'hội an', 'hoi an', 'hoian',
      'điện bàn', 'dien ban', 'núi thành', 'nui thanh', 'duy xuyên', 'duy xuyen',
      'thăng bình', 'quế sơn', 'đại lộc', 'phú ninh', 'tiên phước'
    ]
  },
  // 30. Quảng Ngãi
  {
    name: 'Quảng Ngãi',
    keywords: [
      'quảng ngãi', 'quang ngai', 'quangngai', 'đức phổ', 'duc pho', 'bình sơn', 'binh son',
      'lý sơn', 'ly son', 'tư nghĩa', 'mộ đức', 'nghĩa hành', 'sơn tịnh', 'trà bồng'
    ]
  },
  // 31. Bình Định
  {
    name: 'Bình Định',
    keywords: [
      'bình định', 'binh dinh', 'binhdinh', 'quy nhơn', 'quy nhon', 'quynhon',
      'an nhơn', 'an nhon', 'hoài nhơn', 'hoai nhon', 'phù cát', 'phu cat',
      'phù mỹ', 'tây sơn', 'tuy phước', 'hoài ân'
    ]
  },
  // 32. Phú Yên
  {
    name: 'Phú Yên',
    keywords: [
      'phú yên', 'phu yen', 'phuyen', 'tuy hòa', 'tuy hoa', 'tuyhoa',
      'sông cầu', 'song cau', 'đông hòa', 'dong hoa', 'tây hòa', 'phú hòa', 'tuyết an', 'sơn hòa'
    ]
  },
  // 33. Ninh Thuận
  {
    name: 'Ninh Thuận',
    keywords: [
      'ninh thuận', 'ninh thuan', 'ninhthuan', 'phan rang', 'phan rang - tháp chàm', 'tháp chàm',
      'ninh hải', 'ninh phước', 'ninh sơn', 'thuận bắc', 'thuận nam'
    ]
  },
  // 34. Bình Thuận
  {
    name: 'Bình Thuận',
    keywords: [
      'bình thuận', 'binh thuan', 'binhthuan', 'phan thiết', 'phan thiet', 'phanthiet',
      'la gi', 'lagi', 'mũi né', 'mui ne', 'hàm thuận nam', 'hàm thuận bắc', 'tuy phong', 'bắc bình', 'hàm tân', 'đức linh', 'tánh linh', 'phú quý'
    ]
  },
  // 35. Kon Tum
  {
    name: 'Kon Tum',
    keywords: [
      'kon tum', 'kontum', 'đắk hà', 'dak ha', 'ngọc hồi', 'ngoc hoi', 'sa thầy', 'măng đen', 'mang den', 'đắk tô'
    ]
  },
  // 36. Gia Lai
  {
    name: 'Gia Lai',
    keywords: [
      'gia lai', 'gialai', 'pleiku', 'an khê', 'an khe', 'ayarpa', 'chư sê', 'chu se',
      'chư prông', 'chư păh', 'đắk đoa', 'iagrai', 'kbang', 'kông chro'
    ]
  },
  // 37. Đắk Lắk
  {
    name: 'Đắk Lắk',
    keywords: [
      'đắk lắk', 'đắc lắc', 'dak lak', 'daklak', 'buôn ma thuột', 'buon ma thuot', 'bmt',
      'buôn hồ', 'buon ho', 'cư mgar', 'ea kar', 'krông pắk', 'krông ana', 'krông năng', 'krông bôk', 'cư kuin'
    ]
  },
  // 38. Đắk Nông
  {
    name: 'Đắk Nông',
    keywords: [
      'đắk nông', 'đắc nông', 'dak nong', 'daknong', 'gia nghĩa', 'gia nghia',
      'cư jút', 'đắk mil', 'đắk r\'lấp', 'đắk song', 'krông nô', 'tuy đức'
    ]
  },
  // 39. Tây Ninh
  {
    name: 'Tây Ninh',
    keywords: [
      'tây ninh', 'tay ninh', 'tayninh', 'trảng bàng', 'trang bang', 'hòa thành', 'hoa thanh',
      'gò dầu', 'go dau', 'bến cầu', 'châu thành tây ninh', 'dương minh châu', 'tân biên', 'tân châu tây ninh'
    ]
  },
  // 40. Bình Phước
  {
    name: 'Bình Phước',
    keywords: [
      'bình phước', 'binh phuoc', 'binhphuoc', 'đồng xoài', 'dong xoai', 'phước long', 'phuoc long',
      'bình long', 'binh long', 'tx bình long', 'tx. bình long', 'chơn thành', 'chon thanh',
      'bù đăng', 'bù đốp', 'bù gia mập', 'hớn quản', 'đồng phú', 'lộc ninh'
    ]
  },
  // 41. Long An
  {
    name: 'Long An',
    keywords: [
      'long an', 'longan', 'tân an', 'tan an', 'kiến tường', 'bến lức', 'ben luc',
      'đức hòa', 'duc hoa', 'cần giuộc', 'can giuoc', 'cần đước', 'can duoc',
      'châu thành long an', 'thủ thừa', 'tân trụ', 'thạnh hóa', 'tân thạnh', 'mộc hóa', 'vĩnh hưng'
    ]
  },
  // 42. Tiền Giang
  {
    name: 'Tiền Giang',
    keywords: [
      'tiền giang', 'tien giang', 'tiengiang', 'mỹ tho', 'my tho', 'mytho',
      'gò công', 'go cong', 'cai lậy', 'cai lay', 'cái bè', 'cai be',
      'châu thành tiền giang', 'chợ gạo', 'gò công đông', 'gò công tây', 'tân phước'
    ]
  },
  // 43. Bến Tre
  {
    name: 'Bến Tre',
    keywords: [
      'bến tre', 'ben tre', 'bentre', 'ba tri', 'bình đại', 'châu thành bến tre',
      'chợ lách', 'giồng trôm', 'mỏ cày bắc', 'mỏ cày nam', 'thạnh phú'
    ]
  },
  // 44. Trà Vinh
  {
    name: 'Trà Vinh',
    keywords: [
      'trà vinh', 'tra vinh', 'travinh', 'duyên hải', 'duyen hai', 'tiểu cần', 'tieu can',
      'càng long', 'cầu kè', 'cầu ngang', 'châu thành trà vinh', 'trà cú'
    ]
  },
  // 45. Vĩnh Long
  {
    name: 'Vĩnh Long',
    keywords: [
      'vĩnh long', 'vinh long', 'vinhlong', 'bình minh', 'binh minh', 'long hồ', 'long ho',
      'mang thít', 'tam bình', 'trà ôn', 'vũng liêm', 'bình tân vĩnh long'
    ]
  },
  // 46. Đồng Tháp
  {
    name: 'Đồng Tháp',
    keywords: [
      'đồng tháp', 'dong thap', 'dongthap', 'cao lãnh', 'cao lanh', 'sa đéc', 'sa dec', 'sadec',
      'hồng ngự', 'hong ngu', 'lai vung', 'lấp vò', 'tháp mười', 'thanh bình đồng tháp', 'tam nông đồng tháp', 'châu thành đồng tháp'
    ]
  },
  // 47. An Giang
  {
    name: 'An Giang',
    keywords: [
      'an giang', 'angiang', 'long xuyên', 'long xuyen', 'châu đốc', 'chau doc',
      'tân châu', 'tan chau', 'tri tôn', 'tri ton', 'tịnh biên', 'chợ mới an giang', 'thoại sơn', 'phú tân an giang', 'châu phú', 'châu thành an giang'
    ]
  },
  // 48. Kiên Giang
  {
    name: 'Kiên Giang',
    keywords: [
      'kiên giang', 'kien giang', 'kiengiang', 'phú quốc', 'phu quoc', 'phuquoc',
      'rạch giá', 'rach gia', 'hà tiên', 'ha tien', 'kiên lương', 'hòn đất', 'tân hiệp kiên giang', 'châu thành kiên giang', 'giồng riềng', 'gò quao', 'an biên', 'an minh', 'u minh thượng',
      'minh lương', 'minh luong', 'chợ minh lương', 'cho minh luong', 'ngã ba minh lương', 'nga ba minh luong'
    ]
  },
  // 49. Hậu Giang
  {
    name: 'Hậu Giang',
    keywords: [
      'hậu giang', 'hau giang', 'haugiang', 'vị thanh', 'vi thanh', 'ngã bảy', 'nga bay',
      'long mỹ', 'châu thành hậu giang', 'châu thành a', 'phụng hiệp', 'vị thủy'
    ]
  },
  // 50. Sóc Trăng
  {
    name: 'Sóc Trăng',
    keywords: [
      'sóc trăng', 'soc trang', 'soctrang', 'ngã năm', 'nga nam', 'vĩnh châu', 'vinh chau',
      'châu thành sóc trăng', 'kế sách', 'mỹ tú', 'cù lao dung', 'long phú', 'mỹ xuyên', 'thạnh trị', 'trần đề'
    ]
  },
  // 51. Bạc Liêu
  {
    name: 'Bạc Liêu',
    keywords: [
      'bạc liêu', 'bac lieu', 'baclieu', 'giá rai', 'gia rai',
      'hồng dân', 'phước long bạc liêu', 'vĩnh lợi', 'đông hải', 'hòa bình bạc liêu'
    ]
  },
  // 52. Cà Mau
  {
    name: 'Cà Mau',
    keywords: [
      'cà mau', 'ca mau', 'camau', 'năm căn', 'nam can', 'đầm dơi', 'dam doi',
      'u minh', 'uminh', 'trần văn thời', 'thới bình', 'cái nước', 'phú tân cà mau', 'ngọc hiển'
    ]
  },
  // 53. Lào Cai
  {
    name: 'Lào Cai',
    keywords: [
      'lào cai', 'lao cai', 'laocai', 'sa pa', 'sapa', 'bắc hà', 'bac ha',
      'bảo thắng', 'bảo yên', 'bát xát', 'mường khương', 'si ma cai', 'văn bàn'
    ]
  },
  // 54. Yên Bái
  {
    name: 'Yên Bái',
    keywords: [
      'yên bái', 'yen bai', 'yenbai', 'nghĩa lộ', 'nghia lo', 'mù cang chải', 'mu cang chai',
      'lục yên', 'trạm tấu', 'trấn yên', 'văn chấn', 'văn yên', 'yên bình'
    ]
  },
  // 55. Điện Biên
  {
    name: 'Điện Biên',
    keywords: [
      'điện biên', 'dien bien', 'dienbien', 'điện biên phủ', 'dien bien phu', 'mường lay',
      'mường nhé', 'mường chà', 'tủa chùa', 'tuần giáo', 'điện biên đông', 'nậm pồ'
    ]
  },
  // 56. Hòa Bình
  {
    name: 'Hòa Bình',
    keywords: [
      'hòa bình', 'hoa binh', 'hoabinh', 'lương sơn', 'luong son', 'mai châu', 'mai chau',
      'kim bôi', 'cao phong', 'đà bắc', 'lạc sơn', 'lạc thủy', 'tân lạc', 'yên thủy'
    ]
  },
  // 57. Lai Châu
  {
    name: 'Lai Châu',
    keywords: [
      'lai châu', 'lai chau', 'laichau', 'phong thổ', 'phong tho',
      'mường tè', 'sìn hồ', 'tam đường', 'than uyên', 'tân uyên lai châu', 'nậm nhùn'
    ]
  },
  // 58. Sơn La
  {
    name: 'Sơn La',
    keywords: [
      'sơn la', 'son la', 'sonla', 'mộc châu', 'moc chau', 'mai sơn', 'sông mã',
      'thuận châu', 'phù yên', 'mường la', 'bắc yên', 'vân hồ', 'yên châu', 'quỳnh nhai', 'sốp cộp'
    ]
  },
  // 59. Hà Giang
  {
    name: 'Hà Giang',
    keywords: [
      'hà giang', 'ha giang', 'hagiang', 'đồng văn', 'dong van', 'mèo vạc', 'meo vac',
      'quản bạ', 'yên minh', 'hoàng su phì', 'xín mần', 'bắc quang', 'quang bình', 'vị xuyên', 'bắc mê'
    ]
  },
  // 60. Cao Bằng
  {
    name: 'Cao Bằng',
    keywords: [
      'cao bằng', 'cao bang', 'caobang', 'trùng khánh', 'trung khanh',
      'bảo lạc', 'bảo lâm cao bằng', 'hà quảng', 'hòa an', 'nguyên bình', 'thạch an', 'quảng hòa'
    ]
  },
  // 61. Bắc Kạn
  {
    name: 'Bắc Kạn',
    keywords: [
      'bắc kạn', 'bắc cạn', 'bac kan', 'backan', 'ba bể', 'ba be',
      'bạch thông', 'chợ đồn', 'chợ mới bắc kạn', 'na rì', 'ngân sơn', 'pác nặm'
    ]
  },
  // 62. Lạng Sơn
  {
    name: 'Lạng Sơn',
    keywords: [
      'lạng sơn', 'lang son', 'langson', 'hữu lũng', 'huu lung', 'đồng đăng', 'dong dang',
      'bắc sơn', 'bình gia', 'cao lộc', 'chi lăng', 'đình lập', 'lộc bình', 'tràng định', 'văn lãng', 'văn quan'
    ]
  },
  // 63. Tuyên Quang
  {
    name: 'Tuyên Quang',
    keywords: [
      'tuyên quang', 'tuyen quang', 'tuyenquang', 'sơn dương', 'son duong',
      'chiêm hóa', 'hàm yên', 'lâm bình', 'na hang', 'yên sơn'
    ]
  }
];

// Legacy 63-province names remain useful as search aliases, but output must
// follow the current 34-unit administrative model. Unlisted names are unchanged.
export const CURRENT_PROVINCE_BY_LEGACY = Object.freeze({
  'Bình Dương': 'TP. Hồ Chí Minh',
  'Bà Rịa - Vũng Tàu': 'TP. Hồ Chí Minh',
  'Hải Dương': 'Hải Phòng',
  'Quảng Nam': 'Đà Nẵng',
  'Hậu Giang': 'Cần Thơ',
  'Sóc Trăng': 'Cần Thơ',
  'Thừa Thiên Huế': 'Huế',
  'Yên Bái': 'Lào Cai',
  'Bắc Kạn': 'Thái Nguyên',
  'Vĩnh Phúc': 'Phú Thọ',
  'Hòa Bình': 'Phú Thọ',
  'Bắc Giang': 'Bắc Ninh',
  'Thái Bình': 'Hưng Yên',
  'Hà Nam': 'Ninh Bình',
  'Nam Định': 'Ninh Bình',
  'Quảng Bình': 'Quảng Trị',
  'Kon Tum': 'Quảng Ngãi',
  'Bình Định': 'Gia Lai',
  'Ninh Thuận': 'Khánh Hòa',
  'Đắk Nông': 'Lâm Đồng',
  'Bình Thuận': 'Lâm Đồng',
  'Phú Yên': 'Đắk Lắk',
  'Bình Phước': 'Đồng Nai',
  'Long An': 'Tây Ninh',
  'Bến Tre': 'Vĩnh Long',
  'Trà Vinh': 'Vĩnh Long',
  'Tiền Giang': 'Đồng Tháp',
  'Bạc Liêu': 'Cà Mau',
  'Kiên Giang': 'An Giang',
  'Hà Giang': 'Tuyên Quang'
});

export function toCurrentProvinceName(legacyProvince = '') {
  if (!legacyProvince || legacyProvince === '—') return '—';
  return CURRENT_PROVINCE_BY_LEGACY[legacyProvince] || legacyProvince;
}

function buildLocationResult(legacyProvince, source, confidence, rawEvidence = '') {
  const province = toCurrentProvinceName(legacyProvince);
  return {
    province,
    legacyProvince: legacyProvince !== province ? legacyProvince : '',
    source,
    confidence,
    conflict: false,
    evidence: rawEvidence ? [{
      source,
      rawText: String(rawEvidence).substring(0, 220),
      legacyProvince,
      province,
      confidence
    }] : []
  };
}

// Flatten all province keywords sorted by length descending for greedy match
const COMPILED_KEYWORDS = [];
for (const prov of PROVINCES_MAP) {
  for (const kw of prov.keywords) {
    const kwClean = cleanForMatching(kw);
    if (kwClean) {
      COMPILED_KEYWORDS.push({
        province: prov.name,
        keyword: kwClean,
        keywordNoAccent: cleanForMatching(removeAccents(kwClean)),
        length: kwClean.length
      });
    }
  }
}
COMPILED_KEYWORDS.sort((a, b) => b.length - a.length);

/**
 * Normalizes any raw location string or alias into a canonical Vietnam Province Name (SEARCH-P0-010)
 * @param {string} rawLocation - e.g. "tphcm", "Sài Gòn", "Biên Hòa", "Thủ Đức", "BMT"
 * @returns {string} Canonical province name, or '—' if unrecognized.
 */
export function normalizeProvinceName(rawLocation = '') {
  if (!rawLocation || typeof rawLocation !== 'string') return '—';
  const clean = cleanForMatching(rawLocation);
  if (!clean || clean.length < 2) return '—';

  const cleanPadded = ` ${clean} `;
  const cleanNoAccentPadded = ` ${cleanForMatching(removeAccents(clean))} `;

  // 1. Direct match with canonical province name
  for (const prov of PROVINCES_MAP) {
    if (cleanPadded.includes(` ${cleanForMatching(prov.name)} `)) {
      return toCurrentProvinceName(prov.name);
    }
  }

  // 2. Match with compiled keyword aliases (longest first)
  for (const item of COMPILED_KEYWORDS) {
    if (cleanPadded.includes(` ${item.keyword} `)) {
      return toCurrentProvinceName(item.province);
    }
  }

  // 3. Match with unaccented aliases (>= 3 chars)
  for (const item of COMPILED_KEYWORDS) {
    if (item.length >= 3 && cleanNoAccentPadded.includes(` ${item.keywordNoAccent} `)) {
      return toCurrentProvinceName(item.province);
    }
  }

  return '—';
}

/**
 * Extracts normalized Vietnamese Province/City with detailed source attribution (SEARCH-P0-010).
 * Prioritizes:
 * 1. Post Content (Contextual address cues -> general text) [Confidence: 0.95]
 * 2. Profile Location / Bio [Confidence: 0.85]
 * 3. OCR Image Text [Confidence: 0.80]
 * 4. Author / Shop Display Name [Confidence: 0.70]
 *
 * @param {string|Object} input - String of text OR Object { content, authorName, bio, ocrText, profileLocation }
 * @returns {Object} { province: string, source: string, confidence: number }
 */
export function extractLocationDetailed(input = '') {
  let content = '';
  let authorName = '';
  let bio = '';
  let ocrText = '';
  let profileLocation = '';

  if (typeof input === 'object' && input !== null) {
    content = input.content || '';
    authorName = input.authorName || '';
    bio = input.bio || '';
    ocrText = input.ocrText || '';
    profileLocation = input.profileLocation || '';
  } else if (typeof input === 'string') {
    content = input;
  }

  // 1. Check Content with Address / Location Contextual Indicators (Highest Priority)
  if (content && content.trim()) {
    const contentLower = content.toLowerCase();
    const contextRegex = /(?:địa\s*chỉ|chi\s*nhánh|cơ\s*sở|tại|sống\s*tại|ở|khu\s*vực|đến\s*từ|location|address|lives\s*in|from|cn)[\s:\.\-]*([^\n,\.]{2,80})/gi;
    let cm;
    while ((cm = contextRegex.exec(contentLower)) !== null) {
      const snippet = ` ${cleanForMatching(cm[1])} `;
      for (const item of COMPILED_KEYWORDS) {
        if (snippet.includes(` ${item.keyword} `)) {
          return buildLocationResult(item.province, 'content', 0.95, cm[0]);
        }
      }
    }

    // Check general content text
    const cleanContent = ` ${cleanForMatching(content)} `;
    for (const item of COMPILED_KEYWORDS) {
      if (cleanContent.includes(` ${item.keyword} `)) {
        return buildLocationResult(item.province, 'content', 0.9, item.keyword);
      }
    }

    const cleanContentNoAccent = ` ${cleanForMatching(removeAccents(content))} `;
    for (const item of COMPILED_KEYWORDS) {
      if (item.length >= 5 && cleanContentNoAccent.includes(` ${item.keywordNoAccent} `)) {
        return buildLocationResult(item.province, 'content', 0.85, item.keywordNoAccent);
      }
    }
  }

  // 2. Check Profile Location / Bio
  const profileCombined = `${profileLocation} ${bio}`.trim();
  if (profileCombined) {
    const cleanProf = ` ${cleanForMatching(profileCombined)} `;
    for (const item of COMPILED_KEYWORDS) {
      if (cleanProf.includes(` ${item.keyword} `)) {
        return buildLocationResult(item.province, 'profile', 0.85, item.keyword);
      }
    }
  }

  // 3. Check OCR Text from Images
  if (ocrText && ocrText.trim()) {
    const cleanOCR = ` ${cleanForMatching(ocrText)} `;
    for (const item of COMPILED_KEYWORDS) {
      if (cleanOCR.includes(` ${item.keyword} `)) {
        return buildLocationResult(item.province, 'image_ocr', 0.8, item.keyword);
      }
    }
  }

  // 4. Check Author / Shop Display Name (e.g. "Trà Sữa Biên Hòa", "Bún Chả Sài Gòn")
  if (authorName && authorName.trim()) {
    const authorClean = ` ${cleanForMatching(authorName)} `;
    for (const item of COMPILED_KEYWORDS) {
      if (authorClean.includes(` ${item.keyword} `)) {
        return buildLocationResult(item.province, 'author_name', 0.7, item.keyword);
      }
    }
    const authorNoAccent = ` ${cleanForMatching(removeAccents(authorName))} `;
    for (const item of COMPILED_KEYWORDS) {
      if (item.length >= 4 && authorNoAccent.includes(` ${item.keywordNoAccent} `)) {
        return buildLocationResult(item.province, 'author_name', 0.65, item.keywordNoAccent);
      }
    }
  }

  return buildLocationResult('—', 'unknown', 0);
}

/**
 * Extracts normalized Vietnamese Province/City from text sources.
 * Returns canonical string or '—' (Backward-compatible wrapper for extractLocationDetailed).
 */
export function extractLocationFromText(input = '') {
  const detailed = extractLocationDetailed(input);
  return detailed.province;
}
