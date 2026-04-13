import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { MembersService } from './members.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UpdateRoleDto } from './dto/update-role.dto';

@ApiTags('Members')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller('spaces/:spaceId/members')
export class MembersController {
  constructor(private readonly membersService: MembersService) {}

  /**
   * GET /spaces/:spaceId/members
   * Get all members in a space
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  async getSpaceMembers(@Param('spaceId') spaceId: string): Promise<any> {
    const members = await this.membersService.getSpaceMembers(spaceId);
    return {
      success: true,
      data: members,
    };
  }

  /**
   * GET /spaces/:spaceId/members/search?q=
   * Search members in a space
   */
  @Get('search')
  @HttpCode(HttpStatus.OK)
  async searchMembers(
    @Param('spaceId') spaceId: string,
    @Query('q') query: string,
  ): Promise<any> {
    const members = await this.membersService.searchMembers(
      spaceId,
      query || '',
    );
    return {
      success: true,
      data: members,
    };
  }

  /**
   * GET /spaces/:spaceId/members/:userId/role
   * Get member role
   */
  @Get(':userId/role')
  @HttpCode(HttpStatus.OK)
  async getMemberRole(
    @Param('spaceId') spaceId: string,
    @Param('userId') userId: string,
  ): Promise<any> {
    const role = await this.membersService.getMemberRole(spaceId, userId);
    return {
      success: true,
      data: role,
    };
  }

  /**
   * PATCH /spaces/:spaceId/members/:userId/role
   * Update member role
   */
  @Patch(':userId/role')
  @HttpCode(HttpStatus.OK)
  async updateMemberRole(
    @Param('spaceId') spaceId: string,
    @Param('userId') userId: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser('userId') currentUserId: string,
  ): Promise<any> {
    const member = await this.membersService.updateMemberRole(
      spaceId,
      userId,
      dto.role,
      currentUserId,
    );
    return {
      success: true,
      data: member,
    };
  }

  /**
   * GET /spaces/:spaceId/members/:userId/activity
   * Get member activity
   */
  @Get(':userId/activity')
  @HttpCode(HttpStatus.OK)
  async getMemberActivity(
    @Param('spaceId') spaceId: string,
    @Param('userId') userId: string,
  ): Promise<any> {
    const activity = await this.membersService.getMemberActivity(
      spaceId,
      userId,
    );
    return {
      success: true,
      data: activity,
    };
  }

  /**
   * DELETE /spaces/:spaceId/members/:userId
   * Remove member from space
   */
  @Delete(':userId')
  @HttpCode(HttpStatus.OK)
  async removeMember(
    @Param('spaceId') spaceId: string,
    @Param('userId') userId: string,
    @CurrentUser('userId') currentUserId: string,
  ): Promise<any> {
    await this.membersService.removeMember(spaceId, userId, currentUserId);
    return {
      success: true,
      message: 'Member removed successfully',
    };
  }
}
