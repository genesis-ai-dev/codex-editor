export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

interface FrontEndMessage {
  command: {
    name: string; // use enum
    data?: any; // define based on enum
  };
}
