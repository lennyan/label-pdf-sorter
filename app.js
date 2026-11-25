
"use strict";

// 1. Find the HTML elements by their IDs
const labelInput = document.getElementById("labels");
const ticketInput = document.getElementById("tickets");
const analyzeButton = document.getElementById("analyze");

// 2. Listen for the Analyze PDFs button click
analyzeButton.addEventListener("click", async () => {

    // 3. Get the selected files
    const labelFile = labelInput.files[0];
    const ticketFile = ticketInput.files[0];

    // 4. Make sure both files are selected
    if (!labelFile || !ticketFile) {
        alert("Please select both PDF files.");
        return;
    }

    // 5. Verify the PDF file headers
    try {
        const files = [labelFile, ticketFile];

        for (const file of files) {
            const header = await file.slice(0, 5).text();

            if (header !== "%PDF-") {
                throw new Error(
                    `${file.name} does not have a valid PDF header.`
                );
            }
        }

        // 6. Show the result
        alert(
            "PDF files verified successfully!\n\n" +
            "Shipping Labels: " + labelFile.name + "\n" +
            "Pick Tickets: " + ticketFile.name
        );

    } catch (error) {
        alert("Error: " + error.message);
    }
});
