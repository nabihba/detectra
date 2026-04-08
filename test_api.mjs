import fs from "fs";

const hfToken = process.env.HF_TOKEN;
const testImagePath = "c:/Users/nabih/OneDrive/Desktop/ai_test/dataset/test/FAKE/0 (2).jpg";
const imageBuffer = fs.readFileSync(testImagePath);

// Try the new router API endpoint
const models = ["Organika/sdxl-detector", "umm-maybe/AI-image-detector"];

for (const model of models) {
  console.log(`\nTesting ${model}...`);
  
  // Try new HF router endpoint
  const urls = [
    `https://router.huggingface.co/hf-inference/models/${model}`,
    `https://api-inference.huggingface.co/models/${model}`,
  ];
  
  for (const url of urls) {
    try {
      console.log(`  Trying: ${url}`);
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${hfToken}`,
          "Content-Type": "application/octet-stream",
        },
        body: imageBuffer,
      });
      
      if (!response.ok) {
        const text = await response.text();
        console.log(`  ❌ ${response.status}: ${text.substring(0, 200)}`);
        continue;
      }
      
      const result = await response.json();
      console.log(`  ✅ Result:`, JSON.stringify(result, null, 2));
      process.exit(0);
    } catch (err) {
      console.log(`  ❌ Error: ${err.message}`);
    }
  }
}

console.log("\n❌ All attempts failed");
