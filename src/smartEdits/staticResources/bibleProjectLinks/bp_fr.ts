const french_urls = [
    {
        url: "https://www.youtube.com/watch?v=3m24IHVZ0XM",
        title: "Genèse 1–11 - Synthèse",
        range: "GEN 1-11",
    },
    {
        url: "https://www.youtube.com/watch?v=NylJU42gNnU",
        title: "Genèse 12–50 - Synthèse",
        range: "GEN 12-50",
    },
    {
        url: "https://www.youtube.com/watch?v=6gAkIXm4ZN8",
        title: "Exode 1–18 - Synthèse",
        range: "EXO 1-18",
    },
    {
        url: "https://www.youtube.com/watch?v=GIdz46OiA5s",
        title: "Exode 19–40 - Synthèse",
        range: "EXO 19-40",
    },
    {
        url: "https://www.youtube.com/watch?v=Bule8U5Hfu4",
        title: "Lévitique - Synthèse",
        range: "LEV ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=VxrSqvkN-BY",
        title: "Nombres - Synthèse",
        range: "NUM ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=j8FrGTdho14",
        title: "Deutéronome - Synthèse",
        range: "DEU ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=3r38RWz3k4c",
        title: "Josué - Synthèse",
        range: "JOS ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=CJhCzmboXSQ",
        title: "Juges - Synthèse",
        range: "JUG ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=vwh7UOJYCGw",
        title: "Ruth - Synthèse",
        range: "RUT ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=IfyG_XDWZBU",
        title: "1 Samuel - Synthèse",
        range: "1SA ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=a8yoTzGxOTU",
        title: "2 Samuel - Synthèse",
        range: "2SA ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=uNfWBrrMn4Y",
        title: "1–2 Rois - Synthèse",
        range: "1KI ALL, 2KI ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=zlz7aB9Zmhc",
        title: "1–2 Chroniques - Synthèse",
        range: "1CH ALL, 2CH ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=twgdre6_vdE",
        title: "Esdras-Néhémie - Synthèse",
        range: "EZR ALL, NEH ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=wB1_ziugZB8",
        title: "Esther - Synthèse",
        range: "EST ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=xRQ5ctHjhBs",
        title: "Job - Synthèse",
        range: "JOB ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=T-DvRiiLS1Y",
        title: "Psaumes - Synthèse",
        range: "PSA ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=aY3R8FpE92Q",
        title: "Proverbes - Synthèse",
        range: "PRO ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=VURWsXy1nww",
        title: "Ecclésiaste - Synthèse",
        range: "ECC ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=YE-TO4LMbtQ",
        title: "Cantique des cantiques - Synthèse",
        range: "CANT ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=eOmd1d-6Whw",
        title: "Ésaïe 1–39 - Synthèse",
        range: "ISA 1-39",
    },
    {
        url: "https://www.youtube.com/watch?v=ztaPgwQ5j8k",
        title: "Ésaïe 40–66 - Synthèse",
        range: "ISA 40-66",
    },
    {
        url: "https://www.youtube.com/watch?v=qTz_5zFBDsc",
        title: "Jérémie - Synthèse",
        range: "JER ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=nY4dZgLRzSg",
        title: "Lamentations - Synthèse",
        range: "LAM ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=4Yr9DEYJ9IU",
        title: "Ézéchiel 1–33 - Synthèse",
        range: "EZE 1-33",
    },
    {
        url: "https://www.youtube.com/watch?v=MyFcRxLzW6g",
        title: "Ézéchiel 34–48 - Synthèse",
        range: "EZE 34-48",
    },
    {
        url: "https://www.youtube.com/watch?v=5RyZ2lceuPA",
        title: "Daniel - Synthèse",
        range: "DAN ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=cFUsMnQe1Ts",
        title: "Osée - Synthèse",
        range: "OSE ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=KyfKz8DrhVk",
        title: "Joël - Synthèse",
        range: "JOE ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=8sRTnbX_TJY",
        title: "Amos - Synthèse",
        range: "AMO ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=RgTE--fi8m0",
        title: "Abdias - Synthèse",
        range: "ABD ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=DNjuAr9c7VU",
        title: "Jonas - Synthèse",
        range: "JON ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=dmS-4-0cx5g",
        title: "Michée - Synthèse",
        range: "MIC ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=7rBdJ1JZo9A",
        title: "Nahum - Synthèse",
        range: "NAH ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=lBQbCKsvwCI",
        title: "Habacuc - Synthèse",
        range: "HAB ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=oiTxzjDvjgk",
        title: "Sophonie - Synthèse",
        range: "SOP ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=DOoPKFpFZZE",
        title: "Aggée - Synthèse",
        range: "HAG ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=vyQme1-Libg",
        title: "Zacharie - Synthèse",
        range: "ZEC ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=2ENSIn3OOyE",
        title: "Malachie - Synthèse",
        range: "MAL ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=rUSQ1uS-yI0",
        title: "TaNaK/Ancien Testament - Synthèse",
        range: "TOTAL",
    },
    {
        url: "https://www.youtube.com/watch?v=wOJY7gRBkNU",
        title: "Matthieu 1–13 - Synthèse",
        range: "MAT 1-13",
    },
    {
        url: "https://www.youtube.com/watch?v=mq0vO1vNVfY",
        title: "Matthieu 14–28 - Synthèse",
        range: "MAT 14-28",
    },
    {
        url: "https://www.youtube.com/watch?v=9NhjIuy6_oo",
        title: "Marc - Synthèse",
        range: "MAR ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=Bo46uU2IF9w",
        title: "Luc 1–9 - Synthèse",
        range: "LUC 1-9",
    },
    {
        url: "https://www.youtube.com/watch?v=O-Za0jggT8Q",
        title: "Luc 10–24 - Synthèse",
        range: "LUC 10-24",
    },
    {
        url: "https://www.youtube.com/watch?v=QReuhS_R8Kk",
        title: "Jean 1–12 - Synthèse",
        range: "JOH 1-12",
    },
    {
        url: "https://www.youtube.com/watch?v=isJCKKCZx5A",
        title: "Jean 13–21 - Synthèse",
        range: "JOH 13-21",
    },
    {
        url: "https://www.youtube.com/watch?v=YLnUYCSWD9k",
        title: "Actes 1–12 - Synthèse",
        range: "ACT 1-12",
    },
    {
        url: "https://www.youtube.com/watch?v=M7Xgd_7bfpA",
        title: "Actes 13–28 - Synthèse",
        range: "ACT 13-28",
    },
    {
        url: "https://www.youtube.com/watch?v=8EJmsrA0H4M",
        title: "Romains 1–4 - Synthèse",
        range: "ROM 1-4",
    },
    {
        url: "https://www.youtube.com/watch?v=TYxbJrDgZRg",
        title: "Romains 5–16 - Synthèse",
        range: "ROM 5-16",
    },
    {
        url: "https://www.youtube.com/watch?v=q99CrlpKBrw",
        title: "1 Corinthiens - Synthèse",
        range: "1CO ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=e0ivaY94HjA",
        title: "2 Corinthiens - Synthèse",
        range: "2CO ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=3elnA_n3nWc",
        title: "Galates - Synthèse",
        range: "GAL ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=7pUE5wvhbBI",
        title: "Éphésiens - Synthèse",
        range: "EPH ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=ei_5jKbrUJM",
        title: "Philippiens - Synthèse",
        range: "PHP ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=d9lcTLTNSF4",
        title: "Colossiens - Synthèse",
        range: "COL ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=lTz0CuviQPE",
        title: "1 Thessaloniciens - Synthèse",
        range: "1TH ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=CSLk-ULxAik",
        title: "2 Thessaloniciens - Synthèse",
        range: "2TH ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=2diOsOpbZU4",
        title: "1 Timothée - Synthèse",
        range: "1TI ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=ybNEUUSEfoI",
        title: "2 Timothée - Synthèse",
        range: "2TI ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=2aNe6TsB64w",
        title: "Tite - Synthèse",
        range: "TIT ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=6FHGUa1Usfc",
        title: "Philémon - Synthèse",
        range: "PHM ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=scvkhZ5DyhQ",
        title: "Hébreux - Synthèse",
        range: "HEB ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=_hXVE65I2tw",
        title: "Jacques - Synthèse",
        range: "JAS ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=Pd_6DiSLRAI",
        title: "1 Pierre - Synthèse",
        range: "1PE ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=w6JiduuSdnQ",
        title: "2 Pierre - Synthèse",
        range: "2PE ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=N-q8TaM8opA",
        title: "1–3 Jean - Synthèse",
        range: "1JN ALL, 2JN ALL, 3JN ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=whrJ5C45tgU",
        title: "Jude - Synthèse",
        range: "JUD ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=cAOAPSfpbR4",
        title: "Apocalypse 1–11 - Synthèse",
        range: "REV 1-11",
    },
    {
        url: "https://www.youtube.com/watch?v=HIfJZA9fwbM",
        title: "Apocalypse 12–22 - Synthèse",
        range: "REV 12-22",
    },
    {
        url: "https://www.youtube.com/watch?v=52AO0zKCnA4",
        title: "Nouveau Testament - Synthèse",
        range: "TOTAL",
    },
];

export default french_urls;
