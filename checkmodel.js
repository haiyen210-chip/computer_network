// Script to check available Google Gemini Models
const API_KEY = "AIzaSyDVwvFOlT6krx6A6BIGl_sD6mdfNogoaNs"; // Your Key

async function listModels() {
  console.log("Fetching available models...");
  
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`);
    const data = await response.json();

    if (data.models) {
      console.log("\n--- AVAILABLE MODELS ---");
      data.models.forEach(model => {
        // We only care about models that support 'generateContent'
        if (model.supportedGenerationMethods && model.supportedGenerationMethods.includes('generateContent')) {
           console.log(`✅ ${model.name}`);
           console.log(`   Display Name: ${model.displayName}`);
           console.log(`   Description: ${model.description.substring(0, 60)}...`);
           console.log("------------------------------------------------");
        }
      });
    } else {
      console.log("Error:", data);
    }
  } catch (error) {
    console.error("Network Error:", error);
  }
}

listModels();