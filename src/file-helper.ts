import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { unlink } from 'fs/promises';

export class FileHelper {
    public static readonly rootDir = __dirname;
    public static readonly baseDir = join(FileHelper.rootDir, '/sounds');

    constructor() {
        this.checkAndCreateFolderSystem();
    }

    private checkAndCreateFolderSystem() {
        for (const folder of [FileHelper.baseDir]) {
            this.checkAndCreateFolder(folder);
        }
    }

    private checkAndCreateFolder(folder: string): void {
        if (!existsSync(folder)) {
            mkdirSync(folder);
        }
    }

    public async deleteFilesByPath(files: string[]): Promise<boolean> {
        let status = true;

        for (const file of files) {
            const stat = await this.deleteFile(file);
            status &&= stat;

        }
        return status;
    }

    public async deleteFile(path: string): Promise<boolean> {
        let deleted = false;
        if (existsSync(path)) {
            try {
                await unlink(path);
                deleted = true;
            } catch (e) {
                console.error(e, {path});
            }
        }

        return deleted;
    }
}