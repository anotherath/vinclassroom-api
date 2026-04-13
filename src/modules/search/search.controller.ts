import {
  Controller,
  Get,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { SearchService } from './search.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SearchDto, SearchType } from './dto';

interface RequestWithUser extends Request {
  user: {
    id: string;
    email: string;
  };
}

@ApiTags('Search')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  /**
   * GET /search
   * Global search across messages, users, spaces, and files
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  async search(
    @Query() dto: SearchDto,
    @Request() req: RequestWithUser,
  ): Promise<any> {
    const result = await this.searchService.search(req.user.id, dto);
    
    // Record search for analytics
    await this.searchService.recordSearch(
      req.user.id,
      dto.query,
      dto.type || SearchType.ALL,
    );

    return {
      success: true,
      data: result.results,
      meta: {
        query: result.query,
        total: result.total,
        hasMore: result.hasMore,
        page: result.page,
        limit: result.limit,
        byType: result.byType,
      },
    };
  }

  /**
   * GET /search/popular
   * Get popular search queries
   */
  @Get('popular')
  @HttpCode(HttpStatus.OK)
  async getPopularSearches(
    @Query('type') type?: string,
  ): Promise<any> {
    const searches = await this.searchService.getPopularSearches(type);
    return {
      success: true,
      data: searches,
    };
  }

  /**
   * GET /search/messages
   * Search messages only
   */
  @Get('messages')
  @HttpCode(HttpStatus.OK)
  async searchMessages(
    @Query() dto: SearchDto,
    @Request() req: RequestWithUser,
  ): Promise<any> {
    const messageDto = { ...dto, type: SearchType.MESSAGES };
    const result = await this.searchService.search(req.user.id, messageDto);
    
    return {
      success: true,
      data: result.results,
      meta: {
        query: result.query,
        total: result.total,
        hasMore: result.hasMore,
        page: result.page,
        limit: result.limit,
      },
    };
  }

  /**
   * GET /search/users
   * Search users only
   */
  @Get('users')
  @HttpCode(HttpStatus.OK)
  async searchUsers(
    @Query() dto: SearchDto,
    @Request() req: RequestWithUser,
  ): Promise<any> {
    const userDto = { ...dto, type: SearchType.USERS };
    const result = await this.searchService.search(req.user.id, userDto);
    
    return {
      success: true,
      data: result.results,
      meta: {
        query: result.query,
        total: result.total,
        hasMore: result.hasMore,
        page: result.page,
        limit: result.limit,
      },
    };
  }

  /**
   * GET /search/spaces
   * Search spaces only
   */
  @Get('spaces')
  @HttpCode(HttpStatus.OK)
  async searchSpaces(
    @Query() dto: SearchDto,
    @Request() req: RequestWithUser,
  ): Promise<any> {
    const spaceDto = { ...dto, type: SearchType.SPACES };
    const result = await this.searchService.search(req.user.id, spaceDto);
    
    return {
      success: true,
      data: result.results,
      meta: {
        query: result.query,
        total: result.total,
        hasMore: result.hasMore,
        page: result.page,
        limit: result.limit,
      },
    };
  }

  /**
   * GET /search/files
   * Search files only
   */
  @Get('files')
  @HttpCode(HttpStatus.OK)
  async searchFiles(
    @Query() dto: SearchDto,
    @Request() req: RequestWithUser,
  ): Promise<any> {
    const fileDto = { ...dto, type: SearchType.FILES };
    const result = await this.searchService.search(req.user.id, fileDto);
    
    return {
      success: true,
      data: result.results,
      meta: {
        query: result.query,
        total: result.total,
        hasMore: result.hasMore,
        page: result.page,
        limit: result.limit,
      },
    };
  }
}
