import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  UploadedFile,
  UseInterceptors,
  Body,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { FilesService } from './files.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UploadFileDto, QueryFilesDto } from './dto';

interface RequestWithUser extends Request {
  user: {
    id: string;
    email: string;
  };
}

@ApiTags('Files')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller('files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  /**
   * POST /files
   * Upload a file
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'File to upload (max 100MB)',
        },
        spaceId: {
          type: 'string',
          description: 'Space ID where file belongs',
        },
        roomId: {
          type: 'string',
          description: 'Room ID where file belongs',
        },
        description: {
          type: 'string',
          description: 'File description',
        },
        fileType: {
          type: 'string',
          enum: ['image', 'video', 'audio', 'document', 'other'],
          description: 'File type category',
        },
      },
    },
  })
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadFileDto,
    @Request() req: RequestWithUser,
  ): Promise<any> {
    const result = await this.filesService.uploadFile(req.user.id, file, dto);
    return {
      success: true,
      data: result,
    };
  }

  /**
   * GET /files
   * Get files list
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  async getFiles(
    @Query() query: QueryFilesDto,
    @Request() req: RequestWithUser,
  ): Promise<any> {
    const result = await this.filesService.getFiles(req.user.id, query);
    return {
      success: true,
      data: result.files,
      meta: {
        total: result.total,
        hasMore: result.hasMore,
        page: query.page || 1,
        limit: query.limit || 20,
      },
    };
  }

  /**
   * GET /files/recent
   * Get recent files for user
   */
  @Get('recent')
  @HttpCode(HttpStatus.OK)
  async getRecentFiles(
    @Query('limit') limit: number,
    @Request() req: RequestWithUser,
  ): Promise<any> {
    const files = await this.filesService.getRecentFiles(
      req.user.id,
      limit || 10,
    );
    return {
      success: true,
      data: files,
    };
  }

  /**
   * GET /files/stats
   * Get user's file statistics
   */
  @Get('stats')
  @HttpCode(HttpStatus.OK)
  async getFileStats(@Request() req: RequestWithUser): Promise<any> {
    const stats = await this.filesService.getUserFileStats(req.user.id);
    return {
      success: true,
      data: stats,
    };
  }

  /**
   * GET /files/:fileId
   * Get file by ID
   */
  @Get(':fileId')
  @HttpCode(HttpStatus.OK)
  async getFile(
    @Param('fileId') fileId: string,
    @Request() req: RequestWithUser,
  ): Promise<any> {
    const file = await this.filesService.getFileById(fileId, req.user.id);
    return {
      success: true,
      data: file,
    };
  }

  /**
   * DELETE /files/:fileId
   * Delete a file
   */
  @Delete(':fileId')
  @HttpCode(HttpStatus.OK)
  async deleteFile(
    @Param('fileId') fileId: string,
    @Request() req: RequestWithUser,
  ): Promise<any> {
    await this.filesService.deleteFile(fileId, req.user.id);
    return {
      success: true,
      message: 'File deleted successfully',
    };
  }

  /**
   * GET /spaces/:spaceId/files
   * Get files in a space
   */
  @Get('spaces/:spaceId/files')
  @HttpCode(HttpStatus.OK)
  async getSpaceFiles(
    @Param('spaceId') spaceId: string,
    @Query() query: QueryFilesDto,
    @Request() req: RequestWithUser,
  ): Promise<any> {
    const result = await this.filesService.getSpaceFiles(
      spaceId,
      req.user.id,
      query,
    );
    return {
      success: true,
      data: result.files,
      meta: {
        total: result.total,
        hasMore: result.hasMore,
        page: query.page || 1,
        limit: query.limit || 20,
      },
    };
  }
}
