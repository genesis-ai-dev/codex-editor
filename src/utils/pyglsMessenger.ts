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

async function checkServerLife(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1000); // Set a 1-second timeout

    socket.connect(PORT, HOST, () => {
      socket.destroy();
      resolve(true);
    });

    socket.on('error', () => {
      resolve(false);
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
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
  async getSimilarDrafts(ref: string, limit: number = 5): Promise<any> {
    return this.sendRequest('get_similar_drafts', { 'ref': ref, 'limit': limit });
  }

  async getRarity(textType: string, text: string): Promise<any> {
    return this.sendRequest('get_rarity', { text_type: textType, text });
  }

  async getText(ref: string, textType: string): Promise<any> {
    return this.sendRequest('get_text', { ref, text_type: textType });
  }

  async detectAnomalies(query: string, limit: number = 10): Promise<any> {
    // FIXME: we should enable anomaly detection via a settings configuration
    // And we can add a 'quick fix' to disable anomaly detection
    return this.sendRequest('detect_anomalies', { query, limit });
  }

  async applyEdit(uri: string, before: string, after: string): Promise<any> {
    return this.sendRequest('apply_edit', { uri, before, after });
  }
  async getHoveredWord(): Promise<any> {
    const response = await this.sendRequest('hover_word', {});
    return response['word'];
  }
  async getHoveredLine(): Promise<any> {
    const response = await this.sendRequest('hover_line', {});
    return response['line'];
  }
  async getStatus(key: string): Promise<any> {
    const response = await this.sendRequest('get_status', { key });
    return response['status'];
  }
  async setStatus(value: string, key: string): Promise<any> {
    const response = await this.sendRequest('set_status', { value, key });
    return response['status'];
  }
  async smartEdit(before: string, after: string, query: string): Promise<any> {
    const response = await this.sendRequest('smart_edit', { before, after, query });
    return response['text'];
  }
  // Add function to get glosser information
}

export { PythonMessenger, checkServerLife };
