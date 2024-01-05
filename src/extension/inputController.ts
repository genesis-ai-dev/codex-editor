// This code is for handling the cell inputs, such as auto-completions

import { DEBUG_MODE, NAME, MIME_TYPE, LABEL, LANGUAGE, DESCRIPTION } from '../common/common';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
