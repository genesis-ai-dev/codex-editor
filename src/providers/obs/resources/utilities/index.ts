export const getResourceType = (subject: string) => {
    if (subject === "Open Bible Stories") return "obs";
    if (subject === "Bible") return "bible";
    if (subject === "TSV Translation Notes") return "tn";
    if (subject === "Translation Academy") return "ta";
    if (subject === "Translation Questions") return "tq";
    if (subject === "TSV Translation Questions") return "tq";
    if (subject === "Translation Words") return "tw";
    if (subject === "TSV Translation Words Links") return "twl";
    if (
        subject === "OBS Translation Notes" ||
        subject === "TSV OBS Translation Notes"
    )
        return "obs-tn";
    if (subject === "OBS Translation Questions") return "obs-tq";
    if (subject === "TSV OBS Translation Questions") return "obs-tq";
    if (
        subject === "OBS Translation Words Links" ||
        subject === "TSV OBS Translation Words Links"
    )
        return "obs-twl";
    throw new Error("Invalid resource type");
};
