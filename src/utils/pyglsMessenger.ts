import * as net from 'net';

const HOST = 'localhost';
const PORT = 8857;

async function sendMessage(data: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();

    socket.connect(PORT, HOST, () => {
      console.log('Connected to socket server');
      socket.write(data, 'utf-8', () => {
        console.log('Data sent to socket server');
      });
    });

    socket.on('data', (response) => {
      const responseString = response.toString('utf-8');
      console.log('Received response from socket server:', responseString);
      socket.destroy();
      console.log('Disconnected from socket server');
      resolve(responseString);
    });

    socket.on('error', (error) => {
      console.error('Socket error:', error);
      socket.destroy();
      reject(error);
    });
  });
}

class PythonMessenger {
  private async sendRequest(functionName: string, args: any): Promise<any> {
    const requestData = JSON.stringify({ function_name: functionName, args });
    const response = await sendMessage(requestData);
    return JSON.parse(response);
  }

  async verseLad(query: string, vref: string): Promise<any> {
    return this.sendRequest('verse_lad', { query, vref });
  }

  async search(textType: string, query: string, limit: number = 10): Promise<any> {
    return this.sendRequest('search', { text_type: textType, query, limit });
  }
  async searchResources(query: string, limit: number = 10): Promise<any> {
    return this.sendRequest('search_resources', { query, limit });
  }
  async getMostSimilar(textType: string, text: string): Promise<any> {
    return this.sendRequest('get_most_similar', { text_type: textType, text });
  }

  async getRarity(textType: string, text: string): Promise<any> {
    return this.sendRequest('get_rarity', { text_type: textType, text });
  }

  async getText(ref: string, textType: string): Promise<any> {
    return this.sendRequest('get_text', { ref, text_type: textType });
  }

  async detectAnomalies(query: string, limit: number = 10): Promise<any> {
    return this.sendRequest('detect_anomalies', { query, limit });
  }
  async searchForEdits(before: string, after: string): Promise<any> {
    return this.sendRequest('search_for_edits', { before, after });
  }

  async getEditResults(): Promise<any> {
      return this.sendRequest('get_edit_results', {});
  }
  async applyEdit(uri: string, before: string, after: string): Promise<any> {
    return this.sendRequest('apply_edit', { uri, before, after });
  }
}

export { PythonMessenger };