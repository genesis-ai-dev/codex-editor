const german_urls = [
    {
        url: "https://www.youtube.com/watch?v=GiUqfyxGieA",
        title: "Übersicht: Altes Testament",
        range: "TOTAL",
    },
    {
        url: "https://www.youtube.com/watch?v=P9BxBKx8hlM",
        title: "Buchvideo: Genesis (1. Mose) Kap. 1-11",
        range: "GEN 1-11",
    },
    {
        url: "https://www.youtube.com/watch?v=LgITkuI_46A",
        title: "Buchvideo: Genesis (1. Mose) Kap. 12-50",
        range: "GEN 12-50",
    },
    {
        url: "https://www.youtube.com/watch?v=bOhDKsdxwdk",
        title: "Buchvideo: Exodus (2. Mose) Kap. 1-18",
        range: "EXO 1-18",
    },
    {
        url: "https://www.youtube.com/watch?v=FDwxYLOigPM",
        title: "Buchvideo: Exodus (2. Mose) Kap. 19-40",
        range: "EXO 19-40",
    },
    {
        url: "https://www.youtube.com/watch?v=U9GFT-MO6WY",
        title: "Buchvideo: Levitikus (3. Mose)",
        range: "LEV 1-27",
    },
    {
        url: "https://www.youtube.com/watch?v=J6OhuhdD4vU",
        title: "Buchvideo: Numeri (4. Mose)",
        range: "NUM 1-36",
    },
    {
        url: "https://www.youtube.com/watch?v=Eu7K6Vd7jLM",
        title: "Buchvideo: Deuteronomium (5. Mose)",
        range: "DEU 1-32",
    },
    {
        url: "https://www.youtube.com/watch?v=5EOv0AUXo1Q",
        title: "Buchvideo: Josua",
        range: "JOS 1-24",
    },
    {
        url: "https://www.youtube.com/watch?v=dclxjfBPgkc",
        title: "Buchvideo: Richter",
        range: "RUT 1-22",
    },
    {
        url: "https://www.youtube.com/watch?v=UYn3koCqqUc",
        title: "Buchvideo: 1. Samuel",
        range: "1SA 1-31",
    },
    {
        url: "https://www.youtube.com/watch?v=jdGu7U0pcVY",
        title: "Buchvideo: 2. Samuel",
        range: "2SA 1-24",
    },
    {
        url: "https://www.youtube.com/watch?v=n7TrGldij-o",
        title: "Buchvideo: Könige",
        range: "1KI 1-29",
    },
    {
        url: "https://www.youtube.com/watch?v=PVkASigeqD0",
        title: "Buchvideo: Jesaja Kap. 1-39",
        range: "ISA 1-39",
    },
    {
        url: "https://www.youtube.com/watch?v=dgJvi3DopD0",
        title: "Buchvideo: Jesaja Kap. 40-66",
        range: "ISA 40-66",
    },
    {
        url: "https://www.youtube.com/watch?v=2hFQoNVe55w",
        title: "Buchvideo: Jeremia",
        range: "JER ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=hQ2YgxGCKoA",
        title: "Buchvideo: Hosea",
        range: "HOE ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=qpNaQ2cMMlk",
        title: "Buchvideo: Joel",
        range: "JOE ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=rn3PpM2pnog",
        title: "Buchvideo: Amos",
        range: "AMO ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=FMlWKSd0Sgw",
        title: "Buchvideo: Obadja",
        range: "OBA ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=FbhXx3EAvGI",
        title: "Buchvideo: Jona",
        range: "JON ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=M4xHtQQ4vik",
        title: "Buchvideo: Micha",
        range: "MIC ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=3urB4sFuIM4",
        title: "Buchvideo: Nahum",
        range: "NAH ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=7B3ngdxDMGg",
        title: "Buchvideo: Habakuk",
        range: "HAB ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=zJezRH2kdgE",
        title: "Buchvideo: Zefanja",
        range: "ZEF ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=vVW2IthkhgM",
        title: "Buchvideo: Psalmen",
        range: "PSA ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=Fb0FBrvO7zQ",
        title: "Buchvideo: Hiob",
        range: "JOB ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=IF1bCncMGfw",
        title: "Buchvideo: Rut",
        range: "RUT ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=CZtN1nW_18k",
        title: "Buchvideo: Sprüche",
        range: "PRO ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=QkhASgIUrkM",
        title: "Buchvideo: Prediger",
        range: "ECC ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=cu4pQ-G3nV8",
        title: "Buchvideo: Hohelied",
        range: "SON ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=Kysg5GET0o0",
        title: "Buchvideo: Klagelieder",
        range: "SNG ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=L0h5QNJiVXc",
        title: "Buchvideo: Hesekiel Teil 1",
        range: "HES 1-24",
    },
    {
        url: "https://www.youtube.com/watch?v=2gxebq-PTCg",
        title: "Buchvideo: Hesekiel Teil 2",
        range: "HES 25-48",
    },
    {
        url: "https://www.youtube.com/watch?v=u9Jp9gc_Cgo",
        title: "Buchvideo: Ester",
        range: "EST ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=aOs-QRJl8xY",
        title: "Buchvideo: Daniel",
        range: "DAN ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=mPt3d4D4NsM",
        title: "Buchvideo: Haggai",
        range: "HAG ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=_N26FJaOCkE",
        title: "Buchvideo: Sacharja",
        range: "ZAC ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=J3Mm5McR0Ak",
        title: "Buchvideo: Maleachi",
        range: "MAL ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=MyhFWaS9LJs",
        title: "Buchvideo: Chroniken",
        range: "CHR ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=SGO0vu2-xSk",
        title: "Buchvideo: Esra Nehemia",
        range: "EZR ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=L9Y0z1OZpLg",
        title: "Übersichtsvideo: Neues Testament",
        range: "NT ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=YnfiW_xBsMQ",
        title: "Buchvideo: Matthäus Kap. 1-13",
        range: "MAT 1-13",
    },
    {
        url: "https://www.youtube.com/watch?v=qjafm3VQRUY",
        title: "Buchvideo: Matthäus Kap. 14-28",
        range: "MAT 14-28",
    },
    {
        url: "https://www.youtube.com/watch?v=If-fs-dl84o",
        title: "Buchvideo: Markus",
        range: "MRK ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=1Dx63MbgbhA",
        title: "Buchvideo: Johannes Kap. 1-12",
        range: "JON 1-12",
    },
    {
        url: "https://www.youtube.com/watch?v=JwwzKyfkoTw",
        title: "Buchvideo: Johannes Kap. 13-21",
        range: "JON 13-21",
    },
    {
        url: "https://www.youtube.com/watch?v=hFSY9wmaTxE",
        title: "Buchvideo: Lukas Kap. 1-9",
        range: "LUK 1-9",
    },
    {
        url: "https://www.youtube.com/watch?v=w5A64cBbyf0",
        title: "Buchvideo: Lukas Kap. 10-24",
        range: "LUK 10-24",
    },
    {
        url: "https://www.youtube.com/watch?v=9XLmtudlWDg",
        title: "Buchvideo: Apostelgeschichte Kap. 1-12",
        range: "ACT 1-12",
    },
    {
        url: "https://www.youtube.com/watch?v=utaAu5qNZig",
        title: "Buchvideo: Apostelgeschichte Kap. 13-28",
        range: "ACT 13-28",
    },
    {
        url: "https://www.youtube.com/watch?v=DQyi-r6iV8U",
        title: "Buchvideo: Römer Kap. 1-4",
        range: "ROM 1-4",
    },
    {
        url: "https://www.youtube.com/watch?v=OLGU1dsTbyg",
        title: "Buchvideo: Römer Kap. 5-16",
        range: "ROM 5-16",
    },
    {
        url: "https://www.youtube.com/watch?v=LuurVpuqEr0",
        title: "Buchvideo: 1. Korinther",
        range: "1CO ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=ZnloEyPB6F4",
        title: "Buchvideo: 2. Korinther",
        range: "2CO ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=7itkqlIH_4Q",
        title: "Buchvideo: Galater",
        range: "GAL ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=aG3c1LO-poI",
        title: "Buchvideo: Epheser",
        range: "EPH ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=H-1LF1LXOgc",
        title: "Buchvideo: Philipper",
        range: "PHP ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=nLMMB4ZeHT8",
        title: "Buchvideo: Kolosser",
        range: "COL ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=ZRtD-YidDDs",
        title: "Buchvideo: 1. Thessalonicher",
        range: "1TH ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=yQu8rJFdzZM",
        title: "Buchvideo: 2. Thessalonicher",
        range: "2TH ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=fKHQqofGzN4",
        title: "Buchvideo: 1. Timotheus",
        range: "1TI ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=oa4X85AurwM",
        title: "Buchvideo: 2.Timotheus",
        range: "2TI ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=2liHZlumVcs",
        title: "Buchvideo: Titus",
        range: "TIT ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=4oFlijk3jWQ",
        title: "Buchvideo: Philemon",
        range: "PHM ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=bja6fTJ3t8U",
        title: "Buchvideo: Hebräer",
        range: "HEB ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=4hLzi0LrmSU",
        title: "Buchvideo: Jakobus",
        range: "JAS ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=nWMnVKAF8Jk",
        title: "Buchvideo: 1.Petrus",
        range: "1PE ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=lGtu3NVEkT4",
        title: "Buchvideo: 2. Petrus",
        range: "2PE ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=j1EPdjp2zNY",
        title: "Buchvideo: Johannesbriefe",
        range: "1JN ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=3D7ysrzVoWg",
        title: "Buchvideo: Judas",
        range: "JUD ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=-daqkqk5k28",
        title: "Buchvideo: Offenbarung Teil 1",
        range: "REV 1-12",
    },
    {
        url: "https://www.youtube.com/watch?v=Pl_LqxxFFAo",
        title: "Buchvideo: Offenbarung Teil 2",
        range: "REV 13-22",
    },
];

export default german_urls;
