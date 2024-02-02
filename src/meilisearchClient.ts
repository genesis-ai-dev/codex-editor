import { MeiliSearch } from "meilisearch";

export const client = new MeiliSearch({
    host: "http://127.0.0.1:7700", // Replace with your Meilisearch instance URL
    apiKey: "aSampleMasterKey", // Replace with your Meilisearch API key if needed
});
