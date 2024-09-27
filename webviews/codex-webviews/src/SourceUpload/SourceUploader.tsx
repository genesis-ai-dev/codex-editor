import React, { useState, useEffect, useRef } from "react";
import { useVSCodeMessageHandler } from "./hooks/useVSCodeMessageHandler";
import * as d3 from "d3";

const vscode = acquireVsCodeApi();
(window as any).vscodeApi = vscode;

const SourceUploader: React.FC = () => {
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [parsedData, setParsedData] = useState<any[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useVSCodeMessageHandler({
        setFile: (file: File) => setSelectedFile(file),
    });

    useEffect(() => {
        if (parsedData.length > 0) {
            renderChart();
        }
    }, [parsedData]);

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            setSelectedFile(file);
            parseFile(file);
        }
    };

    const parseFile = (file: File) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const content = e.target?.result as string;
            d3.csvParse(content, (d) => {
                // Assuming the CSV has 'x' and 'y' columns
                return {
                    x: d.x,
                    y: +d.y, // Convert y to number
                };
            })
                .then((data) => {
                    setParsedData(data);
                    console.log("Parsed data:", data);
                })
                .catch((error) => {
                    console.error("Error parsing CSV:", error);
                    vscode.postMessage({ command: "uploadError", error: error.message });
                });
        };
        reader.readAsText(file);
    };

    const renderChart = () => {
        const svg = d3.select("#chart");
        svg.selectAll("*").remove(); // Clear previous chart

        const margin = { top: 20, right: 20, bottom: 30, left: 40 };
        const width = 400 - margin.left - margin.right;
        const height = 300 - margin.top - margin.bottom;

        const x = d3.scaleBand().range([0, width]).padding(0.1);
        const y = d3.scaleLinear().range([height, 0]);

        const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

        x.domain(parsedData.map((d) => d.x));
        y.domain([0, d3.max(parsedData, (d) => d.y) as number]);

        g.append("g").attr("transform", `translate(0,${height})`).call(d3.axisBottom(x));

        g.append("g").call(d3.axisLeft(y));

        g.selectAll(".bar")
            .data(parsedData)
            .enter()
            .append("rect")
            .attr("class", "bar")
            .attr("x", (d) => x(d.x) as number)
            .attr("y", (d) => y(d.y))
            .attr("width", x.bandwidth())
            .attr("height", (d) => height - y(d.y));
    };

    const handleUpload = () => {
        if (selectedFile) {
            parseFile(selectedFile);
        }
    };

    return (
        <div className="source-uploader">
            <h1>Upload a Source File</h1>
            <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept=".csv, .txt, .doc, .docx"
            />
            {selectedFile && (
                <div>
                    <p>Selected File: {selectedFile.name}</p>
                    <button onClick={handleUpload}>Upload</button>
                </div>
            )}
            <svg id="chart" width="400" height="300"></svg>
        </div>
    );
};

export default SourceUploader;
