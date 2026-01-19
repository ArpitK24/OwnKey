import ignore, { Ignore } from 'ignore';
import { readFile, stat, readdir } from 'fs/promises';
import { join, relative, extname } from 'path';
import { existsSync } from 'fs';
import { FileMetadata, FileContent, ScanResult } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { DEFAULT_EXCLUDES, BINARY_EXTENSIONS, MAX_FILE_SIZE_BYTES } from '../config/defaults.js';

export class FileScanner {
    private ig: Ignore;
    private maxFileSize: number;
    private rootPath: string;
    private skippedFiles: string[] = [];
    private warnings: string[] = [];

    constructor(rootPath: string, maxFileSize: number = MAX_FILE_SIZE_BYTES) {
        this.rootPath = rootPath;
        this.maxFileSize = maxFileSize;
        this.ig = ignore();
        this.ig.add(DEFAULT_EXCLUDES);
    }

    async initialize(): Promise<void> {
        // Load .gitignore
        const gitignorePath = join(this.rootPath, '.gitignore');
        if (existsSync(gitignorePath)) {
            const content = await readFile(gitignorePath, 'utf-8');
            this.ig.add(content);
            logger.verbose('Loaded .gitignore patterns');
        }

        // Load .ownkeyignore
        const ownkeyignorePath = join(this.rootPath, '.ownkeyignore');
        if (existsSync(ownkeyignorePath)) {
            const content = await readFile(ownkeyignorePath, 'utf-8');
            this.ig.add(content);
            logger.verbose('Loaded .ownkeyignore patterns');
        }
    }

    async scan(): Promise<ScanResult> {
        await this.initialize();

        const files: FileMetadata[] = [];
        let totalSize = 0;

        await this.scanDirectory(this.rootPath, files);

        for (const file of files) {
            totalSize += file.size;
        }

        logger.verbose(`Scanned ${files.length} files (${this.formatBytes(totalSize)})`);

        if (this.skippedFiles.length > 0) {
            logger.verbose(`Skipped ${this.skippedFiles.length} files`);
        }

        return {
            files,
            totalSize,
            skippedFiles: this.skippedFiles,
            warnings: this.warnings,
        };
    }

    private async scanDirectory(dirPath: string, files: FileMetadata[]): Promise<void> {
        let entries;
        try {
            entries = await readdir(dirPath, { withFileTypes: true });
        } catch (error) {
            this.warnings.push(`Cannot read directory: ${dirPath}`);
            return;
        }

        for (const entry of entries) {
            const fullPath = join(dirPath, entry.name);
            const relativePath = relative(this.rootPath, fullPath);

            // Check if ignored
            if (this.ig.ignores(relativePath)) {
                logger.debug(`Ignored: ${relativePath}`);
                continue;
            }

            if (entry.isDirectory()) {
                await this.scanDirectory(fullPath, files);
            } else if (entry.isFile()) {
                await this.processFile(fullPath, relativePath, files);
            }
        }
    }

    private async processFile(
        fullPath: string,
        relativePath: string,
        files: FileMetadata[]
    ): Promise<void> {
        try {
            const stats = await stat(fullPath);

            // Check file size
            if (stats.size > this.maxFileSize) {
                this.skippedFiles.push(`${relativePath} (too large: ${this.formatBytes(stats.size)})`);
                return;
            }

            // Check if binary
            const ext = extname(fullPath).toLowerCase();
            if (BINARY_EXTENSIONS.includes(ext)) {
                this.skippedFiles.push(`${relativePath} (binary file)`);
                return;
            }

            // Check if file is actually text (simple heuristic)
            if (!(await this.isTextFile(fullPath))) {
                this.skippedFiles.push(`${relativePath} (binary content)`);
                return;
            }

            files.push({
                path: fullPath,
                relativePath,
                size: stats.size,
                lastModified: stats.mtime,
                extension: ext,
            });
        } catch (error) {
            this.warnings.push(`Cannot process file: ${relativePath}`);
        }
    }

    private async isTextFile(filePath: string): Promise<boolean> {
        try {
            const buffer = await readFile(filePath);
            const sample = buffer.subarray(0, Math.min(8000, buffer.length));

            // Check for null bytes (common in binary files)
            for (let i = 0; i < sample.length; i++) {
                if (sample[i] === 0) {
                    return false;
                }
            }

            return true;
        } catch {
            return false;
        }
    }

    async loadFileContents(files: FileMetadata[]): Promise<FileContent[]> {
        const contents: FileContent[] = [];

        for (const file of files) {
            try {
                const content = await readFile(file.path, 'utf-8');
                contents.push({
                    ...file,
                    content,
                });
            } catch (error) {
                logger.warn(`Failed to read file: ${file.relativePath}`);
            }
        }

        return contents;
    }

    private formatBytes(bytes: number): string {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
}
