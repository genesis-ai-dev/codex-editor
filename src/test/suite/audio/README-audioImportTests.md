# Audio Import Tests

This document describes the test suite for audio importing functionality, covering the recent changes to fix FFmpeg errors and CSP violations.

## Test Files

### 1. `audioImport.test.ts`

**Tests for audio import handlers and data URL conversion**

Tests the audio import workflow and related functionality:

- **fileToDataUrl function**: Tests MIME type detection for different audio formats (mp3, wav, m4a, aac, ogg, webm, flac)
- **Data URL format**: Verifies correct data URL format (`data:audio/mpeg;base64,...`)
- **handleSelectAudioFile**: Tests file selection handling, including:
    - No files selected scenario
    - Missing workspace folder error handling
- **handleRequestAudioSegment**: Tests segment extraction error handling
- **Error handling**: Tests graceful handling of missing sessions and invalid inputs

### 2. `audioProcessor.test.ts`

**Tests for audio processing utilities**

Tests the core audio processing functionality:

- **FFmpeg binary path retrieval**: Tests that FFmpeg/FFprobe paths can be retrieved from installer packages
- **Execute permission handling**: Tests automatic permission setting on binaries
- **Error handling**: Tests meaningful error messages for invalid files and paths
- **MIME type detection**: Tests correct identification of audio file extensions
- **File validation**: Tests validation of file paths before processing
- **Invalid file handling**: Tests handling of empty files and non-audio files

## Test Coverage

### Core Functionality

- ✅ FFmpeg/FFprobe binary path retrieval from installer packages
- ✅ Execute permission handling for binaries
- ✅ Data URL conversion with correct MIME types
- ✅ Audio file extension detection
- ✅ Error handling for missing files and invalid inputs

### Audio Import Workflow

- ✅ File selection handling
- ✅ Workspace folder validation
- ✅ Session management
- ✅ Segment extraction error handling
- ✅ Webview message posting

### Edge Cases

- ✅ Missing workspace folder
- ✅ No files selected
- ✅ Non-existent sessions
- ✅ Invalid file paths
- ✅ Empty files
- ✅ Permission errors

## Running the Tests

To run these tests, use the VS Code test runner:

```bash
# Run all audio import tests
npm test -- -t "Audio Import Test Suite"

# Run audio processor tests
npm test -- -t "Audio Processor Test Suite"

# Run specific test file
npm test -- src/test/suite/audioImport.test.ts
npm test -- src/test/suite/audioProcessor.test.ts
```

## Test Structure

Each test file follows the standard Mocha test structure:

```typescript
suite("Test Suite Name", () => {
    setup(() => {
        // Setup before each test
    });

    teardown(() => {
        // Cleanup after each test
    });

    test("should do something specific", async () => {
        // Arrange
        // Act
        // Assert
    });
});
```

## Mocking Strategy

The tests use Sinon for mocking:

- **Webview panels**: Mocked to test message posting without actual webview
- **File dialogs**: Mocked to test file selection scenarios
- **Workspace folders**: Mocked to test workspace validation
- **File system**: Uses temporary directories for isolated testing

## Key Testing Patterns

1. **Arrange-Act-Assert**: Each test follows this clear structure
2. **Isolation**: Tests use temporary directories to avoid side effects
3. **Error Scenarios**: Tests cover both success and error paths
4. **Edge Cases**: Tests handle missing data, invalid inputs, and error conditions

## Limitations

Some tests may skip if FFmpeg packages aren't installed in the test environment:

- FFmpeg binary path tests will skip if `@ffmpeg-installer/ffmpeg` isn't installed
- FFprobe binary path tests will skip if `@ffprobe-installer/ffprobe` isn't installed
- Audio processing tests may skip if binaries aren't available

This is expected behavior - the tests verify error handling when packages aren't available.

## Future Enhancements

The test suite can be extended to include:

- Integration tests with actual FFmpeg binaries
- End-to-end tests with real audio files
- Performance tests for large audio files
- Tests for waveform generation
- Tests for silence detection accuracy
- Tests for segment extraction

## Maintenance

When adding new audio import features:

1. Add corresponding tests to the appropriate test file
2. Update this README if new test files are created
3. Ensure all tests pass before merging changes
4. Consider adding integration tests for complex features
