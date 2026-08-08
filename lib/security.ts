import crypto from 'crypto';

// Utility to generate a valid password meeting constraints: 
// 8 chars, 1 uppercase, 1 number, 1 special char.
export function generateTempPassword(): string {
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const numbers = '0123456789';
  const specials = '!@#$%^&*()_+';
  
  // Pick one of each to guarantee presence using crypto.randomInt
  const char1 = uppercase[crypto.randomInt(0, uppercase.length)];
  const char2 = lowercase[crypto.randomInt(0, lowercase.length)];
  const char3 = numbers[crypto.randomInt(0, numbers.length)];
  const char4 = specials[crypto.randomInt(0, specials.length)];
  
  // Fill remaining characters
  const allChars = uppercase + lowercase + numbers + specials;
  const passwordChars = [char1, char2, char3, char4];
  for (let i = 0; i < 4; i++) {
    passwordChars.push(allChars[crypto.randomInt(0, allChars.length)]);
  }
  
  // Shuffle securely using Fisher-Yates and crypto.randomInt
  for (let i = passwordChars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    const temp = passwordChars[i];
    passwordChars[i] = passwordChars[j];
    passwordChars[j] = temp;
  }
  
  return passwordChars.join('');
}

