from pydantic import BaseModel
from pygls.server import LanguageServer
    
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional, Union
from pydantic import BaseModel, Field

class SenderRole(str, Enum):
    """SenderRole is the role of the sender of a message."""
    USER = "USER"
    AI = "AI"

class Link(BaseModel):
    """Links connect a message of conversation to an identifier where a message is relevant."""
    id: str
    targetId: Optional[str] = None

class Sender(BaseModel):
    """Sender is the sender of a message."""
    name: str
    id: str

class Message(BaseModel):
    """Message is a single content string with metadata about the sender and identifiable anchors for the message."""
    id: str
    role: SenderRole
    sender: Sender
    content: str
    links: List[Link]

class Conversation(BaseModel):
    """Conversation is a list of messages and links to identifiable anchors for the conversation."""
    id: str
    messages: List[Message]
    links: List[Link]

class CellKind(str, Enum):
    """CellKind is the export type of cell."""
    MARKDOWN = "MARKDOWN"
    CODE = "CODE"

class VRef(BaseModel):
    """VRef is a reference to an ORG Bible verse."""
    book: str
    chapter: int
    verse: int

class Note(BaseModel):
    """Note is a single note."""
    id: str
    content: str
    links: List[Link]
    createdAt: datetime
    updatedAt: datetime

class CellMetadata(BaseModel):
    """CellMetadata is the metadata for a cell."""
    vrefs: List[VRef]
    notes: List[Note]
    extra: Dict[str, Any] = Field(alias='[key: string]')

class Cell(BaseModel):
    """Cell is a single cell in a Codex."""
    id: str
    kind: CellKind
    content: str
    links: List[Link]
    metadata: CellMetadata

class Codex(BaseModel):
    """Codex is a Jupyter-like notebook with a list of cells."""
    id: str
    cells: List[Cell]

class LanguageTaggedString(BaseModel):
    """This type represents a string tagged with language information."""
    languageCode: Optional[str] = None
    languageName: Optional[str] = None
    content: str

class DictionaryEntryMetadata(BaseModel):
    """DictionaryEntryMetadata is the metadata for a dictionary entry."""
    extra: Dict[str, Any] = Field(alias='[key: string]')

class DictionaryEntry(BaseModel):
    """DictionaryEntry is a single entry in a dictionary."""
    id: str
    headForm: str
    variantForms: List[Any]  # FIXME: Adjust according to actual use case
    definition: str
    translationEquivalents: List[LanguageTaggedString]
    links: List[Link]
    linkedEntries: List[str]
    metadata: DictionaryEntryMetadata
    notes: List[Note]
    extra: Dict[str, Any] = Field(alias='[key: string]')

class DictionaryMetadata(BaseModel):
    """DictionaryMetadata is the metadata for a dictionary."""
    extra: Dict[str, Any] = Field(alias='[key: string]')

class Dictionary(BaseModel):
    """Dictionary is an extensible JSON dictionary of words and their definitions, plus additional metadata."""
    id: str
    label: str
    path: str
    entries: List[DictionaryEntry]
    metadata: DictionaryMetadata

class ScriptDirection(str, Enum):
    LTR = "ltr"
    RTL = "rtl"

class LanguageProjectStatus(str, Enum):
    """LanguageProjectStatus is the status of a language in a project. E.g., whether it is the source language, the target language, etc."""
    SOURCE = "source"
    TARGET = "target"
    SOURCE_AND_TARGET = "source_and_target"
    REFERENCE = "reference"

class LanguageMetadata(BaseModel):
    """LanguageMetadata is the metadata for a language in a project. Check the status projectStatus for the role of the language in the project."""
    tag: str
    name: Dict[str, str]
    scriptDirection: Optional[ScriptDirection] = None
    iso2b: Optional[str] = None
    iso2t: Optional[str] = None
    iso1: Optional[str] = None
    scope: Optional[str] = None  # FIXME: add enum
    type: Optional[str] = None  # FIXME: add enum
    comment: Optional[str] = None
    refName: Optional[str] = None
    projectStatus: Optional[LanguageProjectStatus] = None
    extra: Dict[str, Any] = Field(alias='[key: string]')

class RelativePath(BaseModel):
    """This is going to be a URI relative to the project root."""

class HTMLString(BaseModel):
    """This is going to be stringified HTML."""

class Generator(BaseModel):
    """Generator is the metadata for the software that generated the project."""
    softwareName: str
    softwareVersion: str
    userName: str

class Meta(BaseModel):
    """Meta is the metadata for the project."""
    version: str
    category: str
    generator: Generator
    defaultLocale: str
    dateCreated: datetime
    normalization: str
    comments: List[str]

class RevisionString(BaseModel):
    """RevisionString is a string with revision information."""
    type: Optional[str] = None
    pattern: Optional[str] = None

class AdditionalProperties(BaseModel):
    """AdditionalProperties is the metadata for additional properties."""
    type: str
    revision: Optional[str] = None
    timestamp: Optional[str] = None
    required: Optional[List[str]] = None

class Primary(BaseModel):
    """Primary is the metadata for primary properties."""
    type: str
    additionalProperties: Optional[AdditionalProperties] = None
    minProperties: Optional[int] = None
    maxProperties: Optional[int] = None
    description: Optional[str] = None

class Upstream(BaseModel):
    """Upstream is the metadata for upstream properties."""
    type: str
    additionalProperties: Optional[AdditionalProperties] = None
    description: Optional[str] = None

class Properties(BaseModel):
    """Properties is the metadata for properties."""
    name: Optional[str] = None
    description: Optional[str] = None
    abbreviation: Optional[str] = None
    primary: Optional[Primary] = None
    upstream: Optional[Upstream] = None

class Identification(BaseModel):
    """Identification is the metadata for identification."""
    title: Optional[str] = None
    type: Optional[str] = None
    description: Optional[str] = None
    definitions: Optional[Dict[str, RevisionString]] = None
    properties: Optional[Properties] = None
    required: Optional[List[str]] = None
    additionalProperties: Optional[bool] = None

class Flavor(BaseModel):
    """Flavor is the metadata for the flavor of the project. (I.e., this metaphor refers to the type of project this is, whether a translation, paratextual data, etc.)"""
    name: str
    usfmVersion: str
    translationType: str
    audience: str
    projectType: str

class FlavorType(BaseModel):
    """FlavorType is the metadata for the type of flavor of the project, including the scope of the Bible that is covered by the project."""
    name: str
    flavor: Flavor
    currentScope: Dict[str, List[str]] = Field(
        default={},
        description="A mapping of book abbreviations to an array of strings.",
        example={
            "GEN": ["Example1", "Example2"],
            "EXO": ["Example1", "Example2"],
            # ... include all other book abbreviations as needed
            "REV": ["Example1", "Example2"]
        }
    )

class ProjectType(BaseModel):
    """ProjectType is the over project metadata object, it is stored in the root-level metadata.json file."""
    format: str
    projectName: str
    projectStatus: Optional[str] = None
    meta: Meta
    idAuthorities: Any
    identification: Identification
    languages: List[LanguageMetadata]
    type: FlavorType
    confidential: bool
    agencies: List[Any]
    targetAreas: List[Any]
    localizedNames: Dict[str, Dict[str, Dict[str, str]]]
    ingredients: Optional[Dict[RelativePath, Dict[str, Union[str, int, List[Any]]]]] = None
    copyright: Dict[str, List[Dict[str, Union[str, HTMLString]]]]