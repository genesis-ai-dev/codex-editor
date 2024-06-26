// Acquire the VS Code API

class smartEditClient {
  private vscode: any;

  constructor(vscode: any) {
    this.vscode = vscode;
  }

  private async sendMessage(before: string, after: string, query: string): Promise<string> {
    return new Promise((resolve, reject) => {
      // Generate a unique ID for this request
      const requestId = Date.now().toString();

      // Set up a message handler
      const messageHandler = (event: MessageEvent) => {
        const message = event.data;
        if (message.requestId === requestId) {
          window.removeEventListener('message', messageHandler);
          if (message.error) {
            reject(new Error(message.error));
          } else {
            resolve(message.result);
          }
        }
      };

      // Add the message listener
      window.addEventListener('message', messageHandler);

      // Send the message to the extension host
      this.vscode.postMessage({
        command: 'smartEdit',
        requestId: requestId,
        before: before,
        after: after,
        query: query
      });
    });
  }
  private async sendRequest(before: string, after: string, query: string): Promise<any> {
    try {
      const response = await this.sendMessage(before=before, after, query);
      console.log('Received response:', response);
      return JSON.parse(response);
    } catch (error) {
      console.error('Error in sendRequest:', error);
      throw error;
    }
  }

  async getSmartEdit(before: string, after: string, query: string): Promise<any> {
    try {
      console.error(`${before} - ${after} -- ${query}`)
      const result = await this.sendRequest(before, after, query);
      console.log('Smart edit result:', result);
      if (typeof result.text !== 'string') {
        console.error('Unexpected result format:', result);
        throw new Error('Unexpected result format');
      }
      return result;
    } catch (error) {
      console.error('Error in getSmartEdit:', error);
      // Fallback to a default response if there's an error
      return { text: 'Error occurred during smart edit. Please try again.' };
    }
  }
}

export { smartEditClient };