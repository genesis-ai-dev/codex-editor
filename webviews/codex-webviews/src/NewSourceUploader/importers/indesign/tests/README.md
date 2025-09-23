# InDesign Importer Tests

This folder contains all testing-related files for the InDesign importer functionality.

## Files

### Core Testing Files
- **`idmlParser.test.ts`** - Main test suite for IDML parsing and round-trip validation
- **`roundTripValidation.test.ts`** - Comprehensive round-trip validation tests
- **`roundTripValidator.ts`** - Round-trip validation utility class
- **`hashUtils.ts`** - Hash computation and comparison utilities for validation

## Test Structure

### IDML Parser Tests (`idmlParser.test.ts`)
- Basic IDML parsing without data loss
- Object ID preservation during parsing
- Round-trip validation for simple documents
- Content and structural change detection
- Complex document parsing with multiple stories
- Nested character style range preservation
- Error handling for malformed XML
- Performance tests with large documents

### Round-Trip Validation Tests (`roundTripValidation.test.ts`)
- Comprehensive validation suite
- Hash-based integrity checking
- Content vs structural validation
- Performance benchmarking
- Edge case handling

### Utilities (`hashUtils.ts`)
- `computeSHA256()` - Generate SHA256 hashes
- `computeContentHash()` - Content-focused hashing (normalized)
- `computeStructuralHash()` - Structure-focused hashing (exact)
- `compareIDMLStructures()` - Compare original vs reconstructed files
- `normalizeXMLForHashing()` - XML normalization for consistent hashing

### Round-Trip Validator (`roundTripValidator.ts`)
- `RoundTripValidator` class for comprehensive validation
- Detailed difference reporting
- Validation result aggregation
- Error handling and reporting

## Running Tests

```bash
# Run all InDesign tests
npm test -- src/NewSourceUploader/importers/indesign/tests/

# Run specific test file
npm test -- src/NewSourceUploader/importers/indesign/tests/idmlParser.test.ts
npm test -- src/NewSourceUploader/importers/indesign/tests/roundTripValidation.test.ts
```

## Test Data

Tests use synthetic XML data that simulates IDML structure rather than actual `.idml` files to ensure:
- Predictable test results
- Fast execution
- Isolated functionality testing
- No external file dependencies

## Validation Approach

The testing system uses a dual-hash approach:
1. **Content Hash** - Validates text content is preserved (normalized XML)
2. **Structural Hash** - Validates formatting and structure is preserved (exact XML)

Both hashes must match for a successful round-trip validation.
