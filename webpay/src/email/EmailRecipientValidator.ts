export class EmailRecipientValidator {
  validateRecipientEmail(email: string): void {
    if (!email) throw new Error('Missing recipientEmail');
    if (typeof email !== 'string' || !/^[^@]+@[^@]+\.[^@]+$/.test(email)) {
      throw new Error('Invalid recipientEmail');
    }
  }
}
