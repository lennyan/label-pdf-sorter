
"use strict";

// Connect PDF.js to its worker file
pdfjsLib.GlobalWorkerOptions.workerSrc = "libs/pdf.worker.min.js";

// Find the HTML elements
const labelInput = document.getElementById("labels");
const ticketInput = document.getElementById("tickets");
const analyzeButton = document.getElementById("analyze");
const result = document.getElementById("result");

// Run when the button is clicked
analyzeButton.addEventListener("click", async () => {

    const labelFile = labelInput.files[0];
    const ticketFile = ticketInput.files[0];

    if (!labelFile || !ticketFile) {
        result.textContent = "Please select both PDF files.";
        return;
    }

    try {
        result.textContent = "Reading PDF...";

        // Read the Shipping Label PDF
        const buffer = await labelFile.arrayBuffer();
        const data = new Uint8Array(buffer);

        // Open the PDF using PDF.js
        const pdf = await pdfjsLib.getDocument({ data }).promise;

        // Get the first page
        const page = await pdf.getPage(1);

        // Extract text from the first page
        const content = await page.getTextContent();

        const text = content.items
            .map(item => item.str)
            .join(" ");

        // Display the result
        result.textContent =
            "Total label pages: " + pdf.numPages + "\n\n" +
            "FIRST PAGE TEXT:\n\n" + text;

    } catch (error) {
        result.textContent = "Error: " + error.message;
        console.error(error);
    }
});
