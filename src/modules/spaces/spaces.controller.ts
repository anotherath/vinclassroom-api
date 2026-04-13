import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { SpacesService } from './spaces.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CreateSpaceDto, UpdateSpaceDto, AddMemberDto } from './dto';

// Extend Request type to include user
interface RequestWithUser extends Request {
  user: { id: string };
}

@ApiTags('Spaces')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller('spaces')
export class SpacesController {
  constructor(private readonly spacesService: SpacesService) {}

  /**
   * Get current user's spaces
   */
  @Get()
  async getUserSpaces(@Req() req: RequestWithUser): Promise<any> {
    const spaces = await this.spacesService.getUserSpaces(req.user.id);
    return {
      success: true,
      data: spaces,
    };
  }

  /**
   * Create a new space
   */
  @Post()
  async createSpace(
    @Req() req: RequestWithUser,
    @Body() dto: CreateSpaceDto,
  ): Promise<any> {
    const space = await this.spacesService.createSpace(req.user.id, dto);
    return {
      success: true,
      data: space,
    };
  }

  /**
   * Get space details by ID
   */
  @Get(':spaceId')
  async getSpaceById(@Param('spaceId') spaceId: string): Promise<any> {
    const space = await this.spacesService.getSpaceById(spaceId);
    return {
      success: true,
      data: space,
    };
  }

  /**
   * Update space
   */
  @Patch(':spaceId')
  async updateSpace(
    @Req() req: RequestWithUser,
    @Param('spaceId') spaceId: string,
    @Body() dto: UpdateSpaceDto,
  ): Promise<any> {
    const space = await this.spacesService.updateSpace(
      spaceId,
      req.user.id,
      dto,
    );
    return {
      success: true,
      data: space,
    };
  }

  /**
   * Delete space
   */
  @Delete(':spaceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteSpace(
    @Req() req: RequestWithUser,
    @Param('spaceId') spaceId: string,
  ): Promise<void> {
    await this.spacesService.deleteSpace(spaceId, req.user.id);
  }

  /**
   * Search public spaces
   */
  @Get('search')
  async searchSpaces(@Query('q') query: string): Promise<any> {
    const spaces = await this.spacesService.searchSpaces(query || '');
    return {
      success: true,
      data: spaces,
    };
  }

  /**
   * Get rooms in a space
   */
  @Get(':spaceId/rooms')
  async getSpaceRooms(@Param('spaceId') spaceId: string): Promise<any> {
    const rooms = await this.spacesService.getSpaceRooms(spaceId);
    return {
      success: true,
      data: rooms,
    };
  }

  /**
   * Add member to space (kept here for backwards compatibility)
   */
  @Post(':spaceId/members')
  async addMember(
    @Param('spaceId') spaceId: string,
    @Body() dto: AddMemberDto,
  ): Promise<any> {
    const member = await this.spacesService.addMember(spaceId, dto);
    return {
      success: true,
      data: member,
    };
  }

  /**
   * Generate invite code for space
   */
  @Post(':spaceId/invite')
  async generateInviteCode(@Param('spaceId') spaceId: string): Promise<any> {
    const inviteCode = await this.spacesService.generateInviteCode(spaceId);
    return {
      success: true,
      data: { inviteCode },
    };
  }

  /**
   * Join space by invite code
   */
  @Post('join/:code')
  async joinByInviteCode(
    @Req() req: RequestWithUser,
    @Param('code') code: string,
  ): Promise<any> {
    const space = await this.spacesService.joinByInviteCode(code, req.user.id);
    return {
      success: true,
      data: space,
    };
  }

  /**
   * Leave space
   */
  @Post(':spaceId/leave')
  @HttpCode(HttpStatus.NO_CONTENT)
  async leaveSpace(
    @Req() req: RequestWithUser,
    @Param('spaceId') spaceId: string,
  ): Promise<void> {
    await this.spacesService.leaveSpace(spaceId, req.user.id);
  }
}
