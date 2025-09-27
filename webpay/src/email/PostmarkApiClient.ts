class PostmarkApiClient {
  async sendEmail(
    emailData: {
      To: string;
      From: string;
      Subject: string;
      HtmlBody: string;
      TextBody: string;
      MessageStream: string;
    },
    postmarkApiKey: string
  ): Promise<void> {
    const fetch = require('node-fetch');
    const resp = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: {
        'X-Postmark-Server-Token': postmarkApiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(emailData)
    });
    if (!resp.ok) {
      const errBody = await resp.text();
      throw new Error(`Postmark API error: ${resp.status} ${errBody}`);
    }
    // No data returned on success
  }
}

export { PostmarkApiClient };
