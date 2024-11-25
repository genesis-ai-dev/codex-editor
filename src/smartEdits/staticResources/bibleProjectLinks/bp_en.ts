const english_urls = [
    {
        url: "https://www.youtube.com/watch?v=GQI72THyO5I",
        title: "Book of Genesis Summary: A Complete Animated Overview (Part 1)",
        range: "GEN ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=KOUV7mWDI34",
        title: "The Main Message of the Book of Genesis • Part 1 • Torah Series (Episode 1)",
        range: "GEN ALL",
    },
    {
        url: "https://www.youtube.com/watch?v=VpbWbyx1008",
        title: "The Main Message of the Book of Genesis • Part 2 • Torah Series (Episode 2)",
        range: "GEN ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=jH_aojNJM3E",
        title: "Book of Exodus Summary: A Complete Animated Overview (Part 1)",
        range: "EXO ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=0uf-PgW7rqE",
        title: "The Book of Exodus - Part 1",
        range: "EXO ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=oNpTha80yyE",
        title: "Book of Exodus Summary: A Complete Animated Overview (Part 2)",
        range: "EXO ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=b0GhR-2kPKI",
        title: "The Book of Exodus - Part 2",
        range: "EXO ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=IJ-FekWUZzE",
        title: "Book of Leviticus Summary: A Complete Animated Overview",
        range: "LEV ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=WmvyrLXoQio",
        title: "Avoiding the Book of Leviticus? • We Break It Down For You (Torah Series Ep. 5)",
        range: "LEV ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=tp5MIrMZFqo",
        title: "Book of Numbers Summary: A Complete Animated Overview",
        range: "NUM ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=l9vn5UvsHvM",
        title: 'What the Idea of "Holiness" Means in the Bible',
        range: "TOTAL",
    },

    {
        url: "https://www.youtube.com/watch?v=q5QEH9bH8AU",
        title: "Book of Deuteronomy Summary: A Complete Animated Overview",
        range: "DEU ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=aS4iM6KpPYo",
        title: 'What It Means to Love God With "All Your Heart"',
        range: "TOTAL",
    },

    {
        url: "https://www.youtube.com/watch?v=g_igCcWAMAM",
        title: 'What It Means to Love God With "All Your Soul"',
        range: "TOTAL",
    },

    {
        url: "https://www.youtube.com/watch?v=9aaVy1AmFX4",
        title: 'What It Means to Love God With "All Your Strength"',
        range: "TOTAL",
    },

    {
        url: "https://www.youtube.com/watch?v=3BGO9Mmd_cU",
        title: "We Studied the Law in the Bible (Here’s What We Found)",
        range: "TOTAL",
    },

    {
        url: "https://www.youtube.com/watch?v=NMhmDPWeftw",
        title: "The Book of Deuteronomy • These Were Moses' Final Words (Torah Series Episode 7)",
        range: "DEU ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=JqOqJlFF_eU",
        title: "Book of Joshua Summary: A Complete Animated Overview",
        range: "JOS ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=kOYy8iCfIJ4",
        title: "Book of Judges Summary: A Complete Animated Overview",
        range: "JDG ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=0h1eoBeR4Jk",
        title: "Book of Ruth Summary: A Complete Animated Overview",
        range: "RUT ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=QJOju5Dw0V0",
        title: "Book of 1 Samuel Summary: A Complete Animated Overview",
        range: "1SA ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=YvoWDXNDJgs",
        title: "Book of 2 Samuel Summary: A Complete Animated Overview",
        range: "2SA ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=3dEh25pduQ8",
        title: "This Is the Hope For Ending the Evil that Affects Your Life",
        range: "TOTAL",
    },

    {
        url: "https://www.youtube.com/watch?v=bVFW3wbi9pk",
        title: "Books of 1-2 Kings Summary: A Complete Animated Overview",
        range: "1KI ALL, 2KI ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=d0A6Uchb1F8",
        title: "Book of Isaiah Summary: A Complete Animated Overview (Part 1)",
        range: "ISA ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=_TzdEPuqgQg",
        title: "Book of Isaiah Summary: A Complete Animated Overview (Part 2)",
        range: "ISA ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=xmFPS0f-kzs",
        title: "How Jesus Became the King of the World (That He Always Was)",
        range: "TOTAL",
    },

    {
        url: "https://www.youtube.com/watch?v=kE6SZ1ogOVU",
        title: "Book of Hosea Summary: A Complete Animated Overview",
        range: "HOS ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=zQLazbgz90c",
        title: "Book of Joel Summary: A Complete Animated Overview",
        range: "JOL ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=mGgWaPGpGz4",
        title: "Book of Amos Summary: A Complete Animated Overview",
        range: "AMO ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=i4ogCrEoG5s",
        title: "Book of Obadiah Summary: A Complete Animated Overview",
        range: "OBA ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=dLIabZc0O4c",
        title: "Book of Jonah Summary: A Complete Animated Overview",
        range: "JON ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=MFEUEcylwLc",
        title: "Book of Micah Summary: A Complete Animated Overview",
        range: "MIC ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=Y30DanA5EhU",
        title: "Book of Nahum Summary: A Complete Animated Overview",
        range: "NHM ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=OPMaRqGJPUU",
        title: "Book of Habakkuk Summary: A Complete Animated Overview",
        range: "HAB ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=oFZknKPNvz8",
        title: "Book of Zephaniah Summary: A Complete Animated Overview",
        range: "ZEP ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=xQwnH8th_fs",
        title: "Book of Job Summary: A Complete Animated Overview",
        range: "JOB ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=GswSg2ohqmA",
        title: "The Book of Job's Wisdom on How God Runs the World",
        range: "TOTAL",
    },

    {
        url: "https://www.youtube.com/watch?v=j9phNEaPrv8",
        title: "Book of Psalms Summary: A Complete Animated Overview",
        range: "PSA ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=AzmYV8GNAIM",
        title: "Book of Proverbs Summary: A Complete Animated Overview",
        range: "PRO ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=Gab04dPs_uA",
        title: "The Book of Proverbs • What It Teaches About Being Good at Life",
        range: "TOTAL",
    },

    {
        url: "https://www.youtube.com/watch?v=lrsQ1tc-2wk",
        title: "Book of Ecclesiastes Summary: A Complete Animated Overview",
        range: "ECC ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=VeUiuSK81-0",
        title: "The Disturbing But Surprising Wisdom of Ecclesiastes [Animated Explainer]",
        range: "TOTAL",
    },

    {
        url: "https://www.youtube.com/watch?v=4KC7xE4fgOw",
        title: "Song of Songs Summary: A Complete Animated Overview",
        range: "SNG ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=RSK36cHbrk0",
        title: "Book of Jeremiah Summary: A Complete Animated Overview",
        range: "JER ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=p8GDFPdaQZQ",
        title: "Book of Lamentations Summary: A Complete Animated Overview",
        range: "LAM ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=R-CIPu1nko8",
        title: "Book of Ezekiel Summary: A Complete Animated Overview (Part 1)",
        range: "EZK ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=SDeCWW_Bnyw",
        title: "Book of Ezekiel Summary: A Complete Animated Overview (Part 2)",
        range: "EZK ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=MkETkRv9tG8",
        title: "Books of Ezra-Nehemiah Summary: A Complete Animated Overview",
        range: "EZR ALL, NEH ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=JydNSlufRIs",
        title: "Book of Esther Summary: A Complete Animated Overview",
        range: "EST ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=9cSC9uobtPM",
        title: "Book of Daniel Summary: A Complete Animated Overview",
        range: "DAN ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=juPvv_xcX-U",
        title: "Book of Haggai Summary: A Complete Animated Overview",
        range: "HAG ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=_106IfO6Kc0",
        title: "Book of Zechariah Summary: A Complete Animated Overview",
        range: "ZCH ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=HPGShWZ4Jvk",
        title: "Book of Malachi Summary: A Complete Animated Overview",
        range: "MAL ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=HR7xaHv3Ias",
        title: "Books of 1-2 Chronicles Summary: A Complete Animated Overview",
        range: "1CH ALL, 2CH ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=3Dv4-n6OYGI",
        title: "Gospel of Matthew Summary: A Complete Animated Overview (Part 1)",
        range: "MAT ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=GGCF3OPWN14",
        title: "Gospel of Matthew Summary: A Complete Animated Overview (Part 2)",
        range: "MAT ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=HGHqu9-DtXk",
        title: "Gospel of Mark Summary: A Complete Animated Overview",
        range: "MRK ALL",
    },

    { url: "https://www.youtube.com/watch?v=OVRixfameGY", title: "Mark", range: "MRK ALL" },

    {
        url: "https://www.youtube.com/watch?v=G-2e9mMf7E8",
        title: "Gospel of John Summary: A Complete Animated Overview (Part 1)",
        range: "JHN ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=RUfh_wOsauk",
        title: "Gospel of John Summary: A Complete Animated Overview (Part 2)",
        range: "JHN ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=XIb_dCIxzr0",
        title: "Gospel of Luke Summary: A Complete Animated Overview (Part 1)",
        range: "LUK ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=_OLezoUvOEQ",
        title: "The Birth of Jesus: Luke 1-2",
        range: "LUK 1-2",
    },

    {
        url: "https://www.youtube.com/watch?v=0k4GbvZUPuo",
        title: "The Baptism of Jesus: Luke 3-9",
        range: "LUK 3-9",
    },

    {
        url: "https://www.youtube.com/watch?v=jUCCUHurV0I",
        title: "The Prodigal Son: Luke 9-19",
        range: "LUK 9-19",
    },

    {
        url: "https://www.youtube.com/watch?v=26z_KhwNdD8",
        title: "Gospel of Luke Summary: A Complete Animated Overview (Part 2)",
        range: "LUK ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=_unHmAf7INk",
        title: "The Crucifixion of Jesus: Luke 19-23",
        range: "LUK 19-23",
    },

    {
        url: "https://www.youtube.com/watch?v=Vb24Lk1Oh5M",
        title: "The Resurrection of Jesus: Luke 24",
        range: "LUK 24",
    },

    {
        url: "https://www.youtube.com/watch?v=CGbNw855ksw",
        title: "Book of Acts Summary: A Complete Animated Overview (Part 1)",
        range: "ACT ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=oNNZO9i1Gjc",
        title: "Understand How the Holy Spirit Works in the Bible",
        range: "TOTAL",
    },

    {
        url: "https://www.youtube.com/watch?v=Z-17KxpjL0Q",
        title: "Book of Acts Summary: A Complete Animated Overview (Part 2)",
        range: "ACT ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=ej_6dVdJSIU",
        title: "Book of Romans Summary: A Complete Animated Overview (Part 1)",
        range: "ROM ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=0SVTl4Xa5fY",
        title: "Book of Romans Summary: A Complete Animated Overview (Part 2)",
        range: "ROM ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=yiHf8klCCc4",
        title: "Book of 1 Corinthians Summary: A Complete Animated Overview",
        range: "1CO ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=3lfPK2vfC54",
        title: "Book of 2 Corinthians Summary: A Complete Animated Overview",
        range: "2CO ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=vmx4UjRFp0M",
        title: "Book of Galatians Summary: A Complete Animated Overview",
        range: "GAL ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=Y71r-T98E2Q",
        title: "Book of Ephesians Summary: A Complete Animated Overview",
        range: "EPH ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=oE9qqW1-BkU",
        title: "Book of Philippians Summary: A Complete Animated Overview",
        range: "PHP ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=pXTXlDxQsvc",
        title: "Book of Colossians Summary: A Complete Animated Overview",
        range: "COL ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=No7Nq6IX23c",
        title: "Book of 1 Thessalonians Summary: A Complete Animated Overview",
        range: "1TH ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=kbPBDKOn1cc",
        title: "Book of 2 Thessalonians Summary: A Complete Animated Overview",
        range: "2TH ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=7RoqnGcEjcs",
        title: "Book of 1 Timothy Summary: A Complete Animated Overview",
        range: "1TI ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=BO1Y9XyWKTw",
        title: "Public Reading of Scripture",
        range: "TOTAL",
    },

    {
        url: "https://www.youtube.com/watch?v=urlvnxCaL00",
        title: "Book of 2 Timothy Summary: A Complete Animated Overview",
        range: "2TI ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=PUEYCVXJM3k",
        title: "Book of Titus Summary: A Complete Animated Overview",
        range: "TIT ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=aW9Q3Jt6Yvk",
        title: "Book of Philemon Summary: A Complete Animated Overview",
        range: "PHM ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=1fNWTZZwgbs",
        title: "Book of Hebrews Summary: A Complete Animated Overview",
        range: "HEB ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=qn-hLHWwRYY",
        title: "Book of James Summary: A Complete Animated Overview",
        range: "JAS ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=WhP7AZQlzCg",
        title: "Book of 1 Peter Summary: A Complete Animated Overview",
        range: "1PE ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=wWLv_ITyKYc",
        title: "Book of 2 Peter Summary: A Complete Animated Overview",
        range: "2PE ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=l3QkE6nKylM",
        title: "Books of 1-3 John Summary: A Complete Animated Overview",
        range: "1JN ALL, 2JN ALL, 3JN ALL",
    },

    {
        url: "https://www.youtube.com/watch?v=6UoCmakZmys",
        title: "Book of Jude Summary: A Complete Animated Overview",
        range: "JUD ALL",
    },
];

export default english_urls;
