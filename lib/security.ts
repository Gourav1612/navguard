// Utility to generate a valid password meeting constraints: 
// 8 chars, 1 uppercase, 1 number, 1 special char.
export function generateTempPassword(): string {
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const numbers = '0123456789';
  const specials = '!@#$%^&*()_+';
  
  // Pick one of each to guarantee presence
  const char1 = uppercase[Math.floor(Math.random() * uppercase.length)];
  const char2 = lowercase[Math.floor(Math.random() * lowercase.length)];
  const char3 = numbers[Math.floor(Math.random() * numbers.length)];
  const char4 = specials[Math.floor(Math.random() * specials.length)];
  
  // Fill remaining characters
  const allChars = uppercase + lowercase + numbers + specials;
  let remaining = '';
  for (let i = 0; i < 4; i++) {
    remaining += allChars[Math.floor(Math.random() * allChars.length)];
  }
  
  return char1 + char2 + char3 + char4 + remaining;
}
