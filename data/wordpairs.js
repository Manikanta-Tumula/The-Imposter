const WORD_PAIRS = [
  ["Virat Kohli", "Rohit Sharma"],
  ["MS Dhoni", "Sachin Tendulkar"],
  ["Messi", "Ronaldo"],
  ["IPL", "World Cup"],
  ["Cricket", "Football"],
  ["Bollywood", "Hollywood"],
  ["Shah Rukh Khan", "Salman Khan"],
  ["Deepika", "Priyanka"],
  ["Aishwarya", "Kareena"],
  ["Ranveer", "Ranbir"],
  ["Amitabh", "Rajinikanth"],
  ["Arijit", "Sonu"],
  ["Kapil Sharma", "Jethalal"],
  ["Doraemon", "Shinchan"],
  ["Motu", "Patlu"],
  ["Chai", "Coffee"],
  ["Samosa", "Pakoda"],
  ["Mango", "Banana"],
  ["Milk", "Curd"],
  ["Onion", "Potato"],
  ["Butter", "Ghee"],
  ["Parle-G", "Britannia"],
  ["Domino's", "McDonald's"],
  ["Zomato", "Swiggy"],
  ["Uber", "Ola"],
  ["iPhone", "Samsung"],
  ["WhatsApp", "Facebook"],
  ["YouTube", "Instagram"],
  ["Nike", "Adidas"],
  ["Ludo", "Carrom"],
  ["Exam", "Vacation"],
  ["School", "College"],
  ["Doctor", "Teacher"],
  ["Wedding", "Birthday"],
  ["Train", "Aeroplane"],
  ["Summer", "Winter"],
  ["Gold", "Silver"],
  ["Kurta", "Saree"],
  ["PUBG", "Free Fire"],
  ["Netflix", "Hotstar"],
  ["Diwali", "Holi"]
];

const PARTNER = {};
for (const [a, b] of WORD_PAIRS) {
  PARTNER[a.toLowerCase()] = b;
  PARTNER[b.toLowerCase()] = a;
}

module.exports = { WORD_PAIRS, PARTNER };
