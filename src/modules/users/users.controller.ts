import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { SearchUsersDto } from './dto/search-users.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

interface UserProfileResponse {
  id: string;
  email?: string;
  full_name?: string;
  avatar_url?: string;
  bio?: string;
  created_at?: string;
  updated_at?: string;
}

interface UserStatusResponse {
  online: boolean;
  lastSeen?: string;
}

interface SearchUsersResponse {
  users: UserProfileResponse[];
  total: number;
  limit: number;
  offset: number;
}

interface BlockUserResponse {
  success: boolean;
}

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * Search users by name or email
   * GET /users/search?q=&limit=&offset=
   */
  @Get('search')
  async searchUsers(
    @Query() query: SearchUsersDto,
    @CurrentUser('id') currentUserId: string,
  ): Promise<SearchUsersResponse> {
    const result = await this.usersService.searchUsers(query, currentUserId);
    return {
      ...result,
      limit: query.limit || 20,
      offset: query.offset || 0,
    };
  }

  /**
   * Get user profile by ID
   * GET /users/:userId
   */
  @Get(':userId')
  async getUserById(
    @Param('userId') userId: string,
  ): Promise<UserProfileResponse> {
    return this.usersService.getUserById(userId);
  }

  /**
   * Get user online status
   * GET /users/:userId/status
   */
  @Get(':userId/status')
  async getUserStatus(
    @Param('userId') userId: string,
  ): Promise<UserStatusResponse> {
    return this.usersService.getUserStatus(userId);
  }

  /**
   * Block a user
   * POST /users/:userId/block
   */
  @Post(':userId/block')
  @HttpCode(HttpStatus.OK)
  async blockUser(
    @Param('userId') blockedId: string,
    @CurrentUser('id') currentUserId: string,
  ): Promise<BlockUserResponse> {
    return this.usersService.blockUser(currentUserId, blockedId);
  }

  /**
   * Unblock a user
   * DELETE /users/:userId/block
   */
  @Delete(':userId/block')
  async unblockUser(
    @Param('userId') blockedId: string,
    @CurrentUser('id') currentUserId: string,
  ): Promise<BlockUserResponse> {
    return this.usersService.unblockUser(currentUserId, blockedId);
  }

  /**
   * Get list of blocked users
   * GET /users/blocked
   */
  @Get('blocked')
  async getBlockedUsers(
    @CurrentUser('id') currentUserId: string,
  ): Promise<UserProfileResponse[]> {
    return this.usersService.getBlockedUsers(currentUserId);
  }
}
