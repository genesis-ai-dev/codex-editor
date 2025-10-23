# InDesign Importer with Round-Trip Loss-Free Editing

This importer provides comprehensive support for Adobe InDesign IDML files with guaranteed round-trip loss-free editing capabilities.

## Features

- **Round-Trip Validation**: Ensures no data loss during import/export cycles
- **Hash-Based Integrity**: Uses SHA-256 hashing to validate file integrity
- **Complete Formatting Preservation**: Maintains all InDesign formatting and styles
- **Object ID Preservation**: Keeps all InDesign object IDs for perfect reconstruction
- **HTML Mapping**: Converts IDML to editable HTML while preserving structure
- **TDD Approach**: Comprehensive test suite ensures reliability

## Architecture

### Core Components

1. **IDMLParser**: Parses IDML XML files into structured documents
2. **IDMLExporter**: Exports structured documents back to IDML XML
3. **HTMLMapper**: Converts between IDML and HTML representations
4. **RoundTripValidator**: Validates round-trip integrity using hash comparison
5. **HashUtils**: Provides cryptographic hash functions for validation

### Round-Trip Process

```
Original IDML → Parse → Structured Document → HTML → Edit → Structured Document → Export → Reconstructed IDML
     ↓                                                                                                    ↓
   Hash A                                                                                            Hash B
     ↓                                                                                                    ↓
                              Compare Hashes → Validation Report
```

## Usage

### Basic Import

```typescript
import { IDMLParser, IDMLExporter, RoundTripValidator } from './indesign';

const parser = new IDMLParser();
const exporter = new IDMLExporter();
const validator = new RoundTripValidator();

// Parse IDML file
const document = await parser.parseIDML(idmlContent);

// Export back to IDML
const reconstructedIDML = await exporter.exportToIDML(document);

// Validate round-trip
const validation = await validator.validateRoundTrip(
    idmlContent, 
    reconstructedIDML, 
    document
);

if (validation.isLossFree) {
    console.log('✅ Round-trip successful - no data loss');
} else {
    console.log('❌ Round-trip failed - differences detected');
    console.log(validator.generateValidationReport(validation));
}
```

### HTML Conversion

```typescript
import { HTMLMapper } from './indesign';

const htmlMapper = new HTMLMapper();

// Convert IDML to HTML
const htmlRepresentation = htmlMapper.convertToHTML(document);
const css = htmlMapper.generateCSS(document);

// Convert HTML back to IDML
const reconstructedDocument = htmlMapper.convertHTMLToIDML(htmlRepresentation);
```

### Configuration

```typescript
const parser = new IDMLParser({
    preserveAllFormatting: true,    // Preserve all formatting
    preserveObjectIds: true,        // Keep InDesign object IDs
    validateRoundTrip: true,        // Enable round-trip validation
    strictMode: false              // Fail on any differences
});

const exporter = new IDMLExporter({
    preserveAllFormatting: true,    // Preserve all formatting
    preserveObjectIds: true,        // Keep InDesign object IDs
    validateOutput: true,          // Validate exported XML
    strictMode: false             // Fail on validation errors
});
```

## Testing

The importer includes comprehensive tests using a TDD approach:

### Test Categories

1. **Basic Round-Trip Tests**: Simple text and formatting preservation
2. **HTML Mapping Tests**: IDML ↔ HTML conversion integrity
3. **Hash-Based Validation**: Cryptographic integrity verification
4. **Complex Document Tests**: Multi-story, nested formatting
5. **Error Handling Tests**: Malformed XML, validation failures
6. **Performance Tests**: Large documents, stress testing

### Running Tests

```bash
# Run all InDesign importer tests
npm test -- src/NewSourceUploader/importers/indesign/tests/

# Run specific test file
npm test -- src/NewSourceUploader/importers/indesign/tests/idmlParser.test.ts
npm test -- src/NewSourceUploader/importers/indesign/tests/roundTripValidation.test.ts

# Run with coverage
npm test -- --coverage src/NewSourceUploader/importers/indesign/tests/
```

### Test Data

The test suite includes various IDML samples:
- Simple text documents
- Complex formatting (bold, italic, colors, fonts)
- Multi-story documents
- Large documents (100+ paragraphs)
- Malformed XML for error testing

## File Structure

```
indesign/
├── types.ts                    # TypeScript interfaces
├── idmlParser.ts              # IDML XML parser
├── idmlExporter.ts            # IDML XML exporter
├── htmlMapper.ts              # IDML ↔ HTML converter
├── InDesignImporterForm.tsx   # React UI component
├── index.tsx                  # Plugin definition
├── index.ts                   # Main exports
├── README.md                  # This file
└── tests/                     # Testing files
    ├── README.md              # Test documentation
    ├── hashUtils.ts           # Cryptographic hash utilities
    ├── roundTripValidator.ts  # Round-trip validation
    ├── idmlParser.test.ts     # Parser tests
    └── roundTripValidation.test.ts # Comprehensive test suite
```

## Supported Features

### IDML Elements
- ✅ Stories (text containers)
- ✅ Paragraphs with style ranges
- ✅ Character style ranges
- ✅ Paragraph styles
- ✅ Character styles
- ✅ Fonts and colors
- ✅ Images and resources
- ✅ Document metadata

### Formatting Properties
- ✅ Text alignment (left, center, right, justify)
- ✅ Spacing (before, after, indents)
- ✅ Font properties (family, size, weight, style)
- ✅ Text decoration (underline, strikethrough)
- ✅ Superscript and subscript
- ✅ Colors (text, background)
- ✅ Tab stops

### Validation Features
- ✅ Content integrity (text preservation)
- ✅ Structural integrity (formatting preservation)
- ✅ Object ID preservation
- ✅ Style reference preservation
- ✅ Metadata preservation
- ✅ Hash-based validation
- ✅ Detailed difference reporting

## Limitations

- **Images**: Inline images are preserved but not processed for editing
- **Complex Layouts**: Multi-column layouts are flattened to single-column
- **Advanced Effects**: Drop shadows, gradients, and other effects are not preserved
- **Master Pages**: Master page content is not imported
- **Layers**: Layer information is not preserved

## Future Enhancements

- [ ] Image processing and editing support
- [ ] Multi-column layout preservation
- [ ] Advanced effect support
- [ ] Master page import
- [ ] Layer preservation
- [ ] Table support
- [ ] Interactive elements support

## Contributing

When contributing to the InDesign importer:

1. **Write Tests First**: Follow TDD approach with comprehensive tests
2. **Validate Round-Trip**: Ensure all changes maintain loss-free editing
3. **Update Documentation**: Keep this README current with new features
4. **Performance**: Consider performance impact of changes
5. **Error Handling**: Provide clear error messages and graceful failures

## License

This importer is part of the Codex Editor project and follows the same license terms.
